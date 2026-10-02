import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

async function inspect() {
  const entryFile = process.env.EXIS_ENTRY_FILE
  if (!entryFile) {
    console.error('EXIS_ENTRY_FILE environment variable is missing.')
    process.exit(1)
  }

  const cwd = process.cwd()
  const dynamicImport = new Function('specifier', 'return import(specifier)')

  // 1. Load .env
  try {
    const { loadEnv } = await import('../config/env.js')
    loadEnv(cwd)
  } catch {
    /* ignore */
  }

  // 2. Register path alias loader
  try {
    const { registerPathAliasLoader } =
      await import('../cli/resolve-aliases.js')
    registerPathAliasLoader(cwd)
  } catch {
    /* ignore */
  }

  // 3. Auto-load Environment variables validation file if it exists
  const envFiles = [
    path.join(cwd, 'src', 'config', 'env.ts'),
    path.join(cwd, 'src', 'config', 'env.js'),
  ]
  for (const envFile of envFiles) {
    if (fs.existsSync(envFile)) {
      await dynamicImport(pathToFileURL(envFile).href).catch(() => {
        /* ignore */
      })
      break
    }
  }

  try {
    const url = pathToFileURL(entryFile).href
    const mod = await dynamicImport(url)

    const isApp = (obj: unknown): boolean =>
      !!(
        obj &&
        typeof obj === 'object' &&
        'getRoutes' in obj &&
        typeof (obj as Record<string, unknown>).getRoutes === 'function'
      )

    let rawApp = mod.default || mod.app
    if (
      rawApp &&
      !rawApp._isExisAppDefinition &&
      typeof rawApp.create !== 'function' &&
      rawApp.default
    ) {
      rawApp = rawApp.default
    }

    let app: any

    if (rawApp && rawApp._isExisAppDefinition) {
      const { App, setActiveAppInstance } = await import('../server/app.js')
      app = new App(rawApp.options)
      setActiveAppInstance(app)
    } else if (
      rawApp &&
      typeof rawApp === 'function' &&
      rawApp.prototype &&
      rawApp.prototype[Symbol.for('exisjs:server_config')]
    ) {
      const serverConfig = rawApp.prototype[Symbol.for('exisjs:server_config')]
      const { App, setActiveAppInstance } = await import('../server/app.js')
      app = new App({ plugins: serverConfig.plugins })
      setActiveAppInstance(app)
    } else {
      const appExport = Object.values(mod).find(isApp)
      app = isApp(rawApp) ? rawApp : appExport
    }

    if (!app) {
      console.error(
        '\x1b[31m[Exis CLI Error]\x1b[0m Your entry file must export an instance of Exis App.'
      )
      process.exit(1)
    }

    // Boot the app to register file-system routes
    try {
      await app.create()
      if (app.routeScanner?.loadAllRoutes) {
        await app.routeScanner.loadAllRoutes()
      }
    } catch {
      /* ignore if already created */
    }

    const routes = app.getRoutes().map((r: any) => ({
      method: r.method,
      path: r.path,
      handlersCount: r.handlers ? r.handlers.length : 1,
      sourceFile: r.sourceFile || null,
    }))

    // Send the extracted routes via IPC if available, otherwise print serialized payload marker
    if (process.send) {
      process.send({ type: 'exis:routes', routes })
      process.exit(0)
    } else {
      console.log(`__EXIS_ROUTES_PAYLOAD__:${JSON.stringify(routes)}`)
      process.exit(0)
    }
  } catch (err: any) {
    console.error(
      '\x1b[31m[Exis CLI Error]\x1b[0m Failed to import app:',
      err?.message || err
    )
    process.exit(1)
  }
}

inspect()
