import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { App } from '../server/app'
import { loadConfig } from '../config/config'

interface RoutesCommandOptions {
  entry?: string
  json?: boolean
  method?: string
  filter?: string
}

export async function routesCommand(
  cwd: string = process.cwd(),
  options: string | RoutesCommandOptions = {}
) {
  process.env.EXIS_CLI_MODE = '1'
  await loadConfig(cwd)

  const opts: RoutesCommandOptions =
    typeof options === 'string' ? { entry: options } : options

  let appPath: string | null = null
  if (opts.entry) {
    const abs = path.resolve(cwd, opts.entry)
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
      mod = await import(pathToFileURL(appPath).href)
    } catch (e: unknown) {
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

    const rawApp = mod.default || mod.app
    let app: App | undefined

    if (rawApp && rawApp._isExisAppDefinition) {
      const { App, setActiveAppInstance } = await import('../server/app')
      app = new App(rawApp.options)
      setActiveAppInstance(app)
    } else if (
      rawApp &&
      typeof rawApp === 'function' &&
      rawApp.prototype &&
      rawApp.prototype[Symbol.for('exisjs:server_config')]
    ) {
      const serverConfig = rawApp.prototype[Symbol.for('exisjs:server_config')]
      const { App, setActiveAppInstance } = await import('../server/app')
      app = new App({ plugins: serverConfig.plugins })
      setActiveAppInstance(app)
    } else {
      const appExport = Object.values(mod).find(isApp)
      app = (isApp(rawApp) ? rawApp : appExport) as App | undefined
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
      if ((app as any).routeScanner?.loadAllRoutes) {
        await (app as any).routeScanner.loadAllRoutes()
      }
    } catch {
      /* ignore if already created */
    }

    let routes = app.getRoutes()

    // Filter by method if specified
    if (opts.method) {
      const targetMethod = opts.method.toUpperCase()
      routes = routes.filter((r) => r.method.toUpperCase() === targetMethod)
    }

    // Filter by keyword if specified
    if (opts.filter) {
      const kw = opts.filter.toLowerCase()
      routes = routes.filter(
        (r) =>
          r.path.toLowerCase().includes(kw) ||
          r.method.toLowerCase().includes(kw) ||
          (r.sourceFile && r.sourceFile.toLowerCase().includes(kw))
      )
    }

    // JSON Output
    if (opts.json) {
      const jsonOutput = routes.map((r) => ({
        method: r.method,
        path: r.path,
        middlewares: Math.max(0, r.handlers.length - 1),
        sourceFile: r.sourceFile
          ? path.relative(cwd, r.sourceFile).replace(/\\/g, '/')
          : null,
      }))
      console.log(JSON.stringify(jsonOutput, null, 2))
      process.exit(0)
    }

    // Terminal Visual Output
    const reset = '\x1b[0m'
    const bold = '\x1b[1m'
    const dim = '\x1b[2m'
    const primary = '\x1b[38;2;160;70;255m'
    const cyan = '\x1b[36m'
    const yellow = '\x1b[33m'
    const gray = '\x1b[90m'

    const methodBadges: Record<string, string> = {
      GET: '\x1b[1;30;42m GET \x1b[0m',
      POST: '\x1b[1;37;44m POST \x1b[0m',
      PUT: '\x1b[1;30;43m PUT \x1b[0m',
      PATCH: '\x1b[1;37;45m PATCH \x1b[0m',
      DELETE: '\x1b[1;37;41m DEL \x1b[0m',
      OPTIONS: '\x1b[1;37;100m OPT \x1b[0m',
      HEAD: '\x1b[1;37;100m HEAD \x1b[0m',
      ALL: '\x1b[1;37;46m ALL \x1b[0m',
    }

    const formatPath = (routePath: string) => {
      // Highlight dynamic parameters like :id or *slug with yellow/cyan
      return routePath.replace(
        /(:[a-zA-Z0-9_]+|\*[a-zA-Z0-9_]+)/g,
        `${yellow}$1${reset}`
      )
    }

    console.log(`\n${primary}${bold}⚡ ExisJS Routing Table${reset}\n`)

    if (routes.length === 0) {
      console.log(`  ${dim}No routes matching criteria.${reset}\n`)
      process.exit(0)
    }

    // Compute column widths
    const renderedPaths = routes.map((r) => r.path)
    const maxPathLen = Math.max(20, ...renderedPaths.map((p) => p.length))
    const maxSourceLen = Math.max(
      15,
      ...routes.map((r) => {
        if (!r.sourceFile) return 6
        const rel = path.relative(cwd, r.sourceFile).replace(/\\/g, '/')
        return rel.length
      })
    )

    // Table Header
    console.log(
      `  ${dim}┌───────┬─${'─'.repeat(maxPathLen)}─┬────────────┬─${'─'.repeat(maxSourceLen)}─┐${reset}`
    )
    console.log(
      `  ${dim}│${reset} ${bold}METHOD${reset} ${dim}│${reset} ${bold}${'PATH'.padEnd(maxPathLen)}${reset} ${dim}│${reset} ${bold}MIDDLEWARES${reset}  ${dim}│${reset} ${bold}${'SOURCE'.padEnd(maxSourceLen)}${reset} ${dim}│${reset}`
    )
    console.log(
      `  ${dim}├───────┼─${'─'.repeat(maxPathLen)}─┼────────────┼─${'─'.repeat(maxSourceLen)}─┤${reset}`
    )

    const methodCounts: Record<string, number> = {}

    for (const route of routes) {
      const method = route.method.toUpperCase()
      methodCounts[method] = (methodCounts[method] || 0) + 1

      const badge =
        methodBadges[method] || `\x1b[1;37;100m ${method.slice(0, 5)} \x1b[0m`
      const rawMethodLen = method === 'DELETE' ? 3 : method.length
      const methodPadding = ' '.repeat(Math.max(0, 5 - rawMethodLen))

      const highlightedPath = formatPath(route.path)
      const pathPadding = ' '.repeat(
        Math.max(0, maxPathLen - route.path.length)
      )

      const mwCount = Math.max(0, route.handlers.length - 1)
      const mwStr =
        mwCount > 0
          ? `${cyan}+${mwCount} step${mwCount > 1 ? 's' : ''}${reset}`
          : `${dim}none${reset}`
      const mwPadding = ' '.repeat(
        Math.max(0, 10 - (mwCount > 0 ? (mwCount > 9 ? 8 : 7) : 4))
      )

      let relSource = '-'
      if (route.sourceFile) {
        relSource = path.relative(cwd, route.sourceFile).replace(/\\/g, '/')
      }
      const sourcePadding = ' '.repeat(
        Math.max(0, maxSourceLen - relSource.length)
      )

      console.log(
        `  ${dim}│${reset} ${badge}${methodPadding} ${dim}│${reset} ${highlightedPath}${pathPadding} ${dim}│${reset} ${mwStr}${mwPadding} ${dim}│${reset} ${dim}${relSource}${reset}${sourcePadding} ${dim}│${reset}`
      )
    }

    console.log(
      `  ${dim}└───────┴─${'─'.repeat(maxPathLen)}─┴────────────┴─${'─'.repeat(maxSourceLen)}─┘${reset}`
    )

    // Summary Card
    const breakdown = Object.entries(methodCounts)
      .map(([m, c]) => `${bold}${c}${reset} ${dim}${m}${reset}`)
      .join(` ${gray}·${reset} `)

    console.log(
      `\n  ${primary}●${reset} Total Endpoints: ${bold}${routes.length}${reset} (${breakdown})\n`
    )
    process.exit(0)
  } catch (err) {
    console.error(
      '\x1b[31m[Exis CLI Error]\x1b[0m Failed to generate route table:',
      err
    )
    process.exit(1)
  }
}
