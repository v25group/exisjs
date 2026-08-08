import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { App } from '../server/app'
import { loadConfig } from '../utils/config'

export async function routesCommand(
  cwd: string = process.cwd(),
  entry?: string
) {
  process.env.EXIS_CLI_MODE = '1'
  await loadConfig(cwd)

  let appPath: string | null = null
  if (entry) {
    const abs = path.resolve(cwd, entry)
    appPath = fs.existsSync(abs) ? abs : null
  } else {
    const srcTs = path.join(cwd, 'src/http/server.ts')
    const srcJs = path.join(cwd, 'src/http/server.js')
    const rootTs = path.join(cwd, 'http/server.ts')
    const rootJs = path.join(cwd, 'http/server.js')

    if (fs.existsSync(srcTs)) appPath = srcTs
    else if (fs.existsSync(srcJs)) appPath = srcJs
    else if (fs.existsSync(rootTs)) appPath = rootTs
    else if (fs.existsSync(rootJs)) appPath = rootJs
  }

  if (!appPath || !fs.existsSync(appPath)) {
    console.error(
      '\x1b[31m[Exis CLI Error]\x1b[0m Could not find application entry point (tried src/http/server.ts or http/server.ts).'
    )
    process.exit(1)
  }

  try {
    // Dynamic import the user's app
    let mod
    try {
      // If we are using tsx, dynamic import will parse the TS file natively
      mod = await import(pathToFileURL(appPath).href)
    } catch (e: unknown) {
      // Fallback to tsx node api if not running within a tsx context
      // Note: We expect the CLI to run with tsx when doing this
      console.error(
        '\x1b[31m[Exis CLI Error]\x1b[0m Failed to import app:',
        e instanceof Error ? e.message : e
      )
      process.exit(1)
    }

    const isApp = (obj: unknown): boolean =>
      !!(
        obj &&
        typeof obj === 'object' &&
        'getRoutes' in obj &&
        typeof (obj as Record<string, unknown>).getRoutes === 'function'
      )

    const appExport = Object.values(mod).find(isApp)
    const app = (isApp(mod.default) ? mod.default : appExport) as
      App | undefined

    if (!app) {
      console.error(
        '\x1b[31m[Exis CLI Error]\x1b[0m Your entry file must export an instance of Exis App. Exported keys: ',
        Object.keys(mod)
      )
      console.log('mod.app:', mod.app)
      console.log('mod.default:', mod.default)
      process.exit(1)
    }

    // Boot the app if it hasn't been booted yet to register file-system routes
    try {
      await app.create()
    } catch {
      /* ignore if already created */
    }

    const routes = app.getRoutes()

    console.log('\n\x1b[36mExis Routing Table\x1b[0m\n')

    if (routes.length === 0) {
      console.log('No routes registered.')
      process.exit(0)
    }

    // Format table
    const maxMethodLen = Math.max(...routes.map((r) => r.method.length))
    const maxPathLen = Math.max(...routes.map((r) => r.path.length))

    for (const route of routes) {
      let methodColor = '\x1b[37m' // white
      switch (route.method) {
        case 'GET':
          methodColor = '\x1b[32m'
          break // green
        case 'POST':
          methodColor = '\x1b[34m'
          break // blue
        case 'PUT':
          methodColor = '\x1b[33m'
          break // yellow
        case 'DELETE':
          methodColor = '\x1b[31m'
          break // red
        case 'PATCH':
          methodColor = '\x1b[35m'
          break // magenta
        case 'WS':
          methodColor = '\x1b[36m'
          break // cyan
        case 'SSE':
          methodColor = '\x1b[34m'
          break // blue
        case 'OPTIONS':
        case 'HEAD':
        case 'CONNECT':
        case 'TRACE':
        case 'QUERY':
        case 'ALL':
          methodColor = '\x1b[90m'
          break // gray
      }

      const methodStr = route.method.padEnd(maxMethodLen)
      const pathStr = route.path.padEnd(maxPathLen)
      const mwCount = route.handlers.length - 1
      const mwStr =
        mwCount > 0 ? `\x1b[90m(+${mwCount} middlewares)\x1b[0m` : ''

      console.log(
        `  ${methodColor}${methodStr}\x1b[0m  \x1b[37m${pathStr}\x1b[0m  ${mwStr}`
      )
    }

    console.log(`\n\x1b[32mTotal routes: ${routes.length}\x1b[0m\n`)
    process.exit(0)
  } catch (err) {
    console.error(
      '\x1b[31m[Exis CLI Error]\x1b[0m Failed to generate route table:',
      err
    )
    process.exit(1)
  }
}
