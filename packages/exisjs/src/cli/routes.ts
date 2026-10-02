import path from 'node:path'
import fs from 'node:fs'
import { fork } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { loadConfig } from '../config/config'
import { registerPathAliasLoader } from './resolve-aliases'

interface RoutesCommandOptions {
  entry?: string
  json?: boolean
  method?: string
  filter?: string
}

export interface ExtractedRoute {
  method: string
  path: string
  handlersCount: number
  sourceFile: string | null
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

  // Ensure path aliases work
  try {
    registerPathAliasLoader(cwd)
  } catch {
    /* ignore */
  }

  // Check if we can/should extract routes via tsx child process (mandatory for .ts / .mts files)
  const isTsFile = appPath.endsWith('.ts') || appPath.endsWith('.mts')
  let routes: ExtractedRoute[]

  if (isTsFile) {
    routes = await extractRoutesViaSubprocess(cwd, appPath)
  } else {
    // Try in-process import for pure .js / .mjs
    try {
      const dynamicImport = new Function(
        'specifier',
        'return import(specifier)'
      )
      const mod = await dynamicImport(pathToFileURL(appPath).href)

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
        const { App, setActiveAppInstance } = await import('../server/app')
        app = new App(rawApp.options)
        setActiveAppInstance(app)
      } else if (
        rawApp &&
        typeof rawApp === 'function' &&
        rawApp.prototype &&
        rawApp.prototype[Symbol.for('exisjs:server_config')]
      ) {
        const serverConfig =
          rawApp.prototype[Symbol.for('exisjs:server_config')]
        const { App, setActiveAppInstance } = await import('../server/app')
        app = new App({ plugins: serverConfig.plugins })
        setActiveAppInstance(app)
      } else {
        const appExport = Object.values(mod).find(isApp)
        app = isApp(rawApp) ? rawApp : appExport
      }

      if (!app) {
        throw new Error('Your entry file must export an instance of Exis App.')
      }

      try {
        await app.create()
        if (app.routeScanner?.loadAllRoutes) {
          await app.routeScanner.loadAllRoutes()
        }
      } catch {
        /* ignore */
      }

      routes = app.getRoutes().map((r: any) => ({
        method: r.method,
        path: r.path,
        handlersCount: r.handlers ? r.handlers.length : 1,
        sourceFile: r.sourceFile || null,
      }))
    } catch {
      // Fallback to subprocess if in-process import failed
      routes = await extractRoutesViaSubprocess(cwd, appPath)
    }
  }

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
      middlewares: Math.max(0, r.handlersCount - 1),
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
    const pathPadding = ' '.repeat(Math.max(0, maxPathLen - route.path.length))

    const mwCount = Math.max(0, route.handlersCount - 1)
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
}

/**
 * Spawns a subprocess with tsx runner to safely import and extract routes from TypeScript applications on Windows and POSIX.
 */
async function extractRoutesViaSubprocess(
  cwd: string,
  appPath: string
): Promise<ExtractedRoute[]> {
  const inspectScript = path.resolve(__dirname, '../lib/inspect-routes.js')

  // Resolve tsx import or cli
  let execArgv: string[] = []
  try {
    const resolvedTsx = require.resolve('tsx', { paths: [cwd, __dirname] })
    execArgv = ['--import', pathToFileURL(resolvedTsx).href]
  } catch {
    try {
      execArgv = [require.resolve('tsx/cli')]
    } catch {
      execArgv = []
    }
  }

  return new Promise((resolve, reject) => {
    let capturedRoutes: ExtractedRoute[] | null = null

    const child = fork(inspectScript, [], {
      cwd,
      execArgv,
      env: {
        ...process.env,
        EXIS_ENTRY_FILE: appPath,
        EXIS_CLI_MODE: '1',
      },
      stdio: ['pipe', 'pipe', 'inherit', 'ipc'],
    })

    child.stdout?.on('data', (data) => {
      const text = data.toString()
      if (text.includes('__EXIS_ROUTES_PAYLOAD__:')) {
        const line = text
          .split('\n')
          .find((l: string) => l.includes('__EXIS_ROUTES_PAYLOAD__:'))
        if (line) {
          try {
            const rawJson = line.split('__EXIS_ROUTES_PAYLOAD__:')[1]
            capturedRoutes = JSON.parse(rawJson)
          } catch {
            /* ignore */
          }
        }
      }
    })

    child.on('message', (msg: any) => {
      if (msg && msg.type === 'exis:routes' && Array.isArray(msg.routes)) {
        capturedRoutes = msg.routes
      }
    })

    child.on('exit', (code) => {
      if (capturedRoutes) {
        resolve(capturedRoutes)
      } else if (code === 0) {
        resolve([])
      } else {
        reject(
          new Error(
            `Failed to extract routes (inspector process exited with code ${code}).`
          )
        )
      }
    })

    child.on('error', (err) => {
      reject(err)
    })
  })
}
