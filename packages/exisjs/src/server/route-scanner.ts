import type { App } from './app'
import { Router } from '../router/router'
import { cors } from '../middleware/middleware'
import { tex } from '../validator/index'
import { pathToFileURL } from 'node:url'
import { executionContext } from './context'
import type { Handler } from '../types'
import { formatDevError } from './dev-error-overlay'

export class RouteScanner {
  public lazyRoutes = new Map<string, { filePath: string; loaded: boolean }>()
  public routeMap = new Map<string, string>()
  public apiDir: string | null = null
  public _allApiDirs?: string[]
  public hasGateways = false

  constructor(public app: App) {}

  async loadAllRoutes(): Promise<void> {
    for (const [filePath, entry] of this.lazyRoutes.entries()) {
      if (!entry.loaded) {
        entry.loaded = true
        this.app.getRouter().removeRoutesBySource('lazy:' + filePath)
        const routePath = this.routeMap.get(filePath)
        if (routePath) {
          try {
            await this.mountRouteFile(filePath, routePath)
          } catch (e) {
            this.app.log.error(
              { err: e, file: filePath },
              'Failed to eager-load route'
            )
          }
        }
      }
    }
  }

  public async autoMountRoutes(root: string): Promise<void> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')

    const isProd = process.env.NODE_ENV === 'production'
    const isDev = this.app.options.env === 'development'

    // Try to load the pre-built manifest first (O(1) boot)
    let manifest: any = undefined

    // STANDALONE MODE: If the bundler statically injected the manifest, skip filesystem!
    if ((globalThis as any).__EXIS_STANDALONE_MANIFEST__) {
      manifest = (globalThis as any).__EXIS_STANDALONE_MANIFEST__
    } else {
      const manifestPath = path.join(root, '.exis', 'routes-manifest.js')
      try {
        const stat = await fs.stat(manifestPath)
        if (stat.isFile()) {
          let url = pathToFileURL(manifestPath).href
          if (!isProd) url += '?t=' + Date.now() // cache bust for dev

          let mod: any
          if (process.env.VITEST || process.env.NODE_ENV === 'test') {
            mod = await import(url)
          } else {
            const dynamicImport = new Function(
              'specifier',
              'return import(specifier)'
            )
            mod = await dynamicImport(url)
          }
          manifest = mod.manifest
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          console.warn('exisjs: Failed to load routes manifest:', err.message)
        }
      }
    }

    if (Array.isArray(manifest)) {
      for (const entry of manifest) {
        const { routePath, module: routeMod, filePath } = entry
        const normalizedPath = path.resolve(root, filePath)
        this.routeMap.set(normalizedPath, routePath)
        const CONTROLLER_PREFIX = Symbol.for('exisjs:controller_prefix')
        const isClassController = (obj: any) =>
          obj && obj.prototype && obj.prototype[CONTROLLER_PREFIX] !== undefined

        const unwrappedMod =
          routeMod.default && routeMod.default.default
            ? routeMod.default.default
            : routeMod.default
              ? routeMod.default
              : routeMod

        const functionalControllerObj =
          unwrappedMod && unwrappedMod.__isController ? unwrappedMod : null

        const routerInstance = routeMod.router || routeMod.default || routeMod

        if (functionalControllerObj) {
          const router = this.compileFunctionalController(
            functionalControllerObj
          )
          this.mountRouteWithSource(routePath, router, normalizedPath)
        } else if (isClassController(routerInstance)) {
          this.app.registerControllers([routerInstance], routePath)
        } else {
          this.mountRouteWithSource(routePath, routerInstance, normalizedPath)
        }
      }
      // Skip the filesystem scan completely!
      return
    }

    const searchDirs = isProd
      ? [
          path.join(root, '.exis', 'server', 'src', 'http'),
          path.join(root, '.exis', 'server', 'http'),
          path.join(root, 'dist', 'src', 'http'),
          path.join(root, 'dist', 'http'),
          path.join(root, 'src', 'http'),
          path.join(root, 'http'),
        ]
      : [path.join(root, 'src', 'http'), path.join(root, 'http')]

    const appDirs: string[] = []
    for (const dir of searchDirs) {
      try {
        const stat = await fs.stat(dir)
        if (stat.isDirectory()) {
          const baseName =
            path.basename(path.dirname(dir)) === 'src' ? 'src/http' : 'http'

          const alreadyHasCompiledOrRawForThisBase = appDirs.some(
            (existing) => {
              const existingBase =
                path.basename(path.dirname(existing)) === 'src'
                  ? 'src/http'
                  : 'http'
              return existingBase === baseName
            }
          )

          if (!alreadyHasCompiledOrRawForThisBase) {
            appDirs.push(dir)
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (appDirs.length === 0) return

    this.apiDir = appDirs[0] // keep property name for backwards compatibility
    ;(this as any)._allApiDirs = appDirs

    const cc = {
      green: '\x1b[32m',
      cyan: '\x1b[36m',
      gray: '\x1b[90m',
      reset: '\x1b[0m',
    }

    for (const appDir of appDirs) {
      const routes = await this.scanDirectory(appDir)

      for (const { filePath, routePath } of routes) {
        if (
          filePath.endsWith('gateway.ts') ||
          filePath.endsWith('gateway.js')
        ) {
          this.hasGateways = true
        }

        if (filePath.endsWith('route.ts') || filePath.endsWith('route.js')) {
          const normalized = path.resolve(filePath)
          this.routeMap.set(normalized, routePath)

          if (isDev) {
            const lazyKey = normalized
            this.lazyRoutes.set(lazyKey, {
              filePath: normalized,
              loaded: false,
            })

            const lazyHandler: Handler = async (req, res, next) => {
              const entry = this.lazyRoutes.get(lazyKey)
              if (entry && !entry.loaded) {
                entry.loaded = true
                this.app.getRouter().removeRoutesBySource('lazy:' + lazyKey)
                try {
                  await this.mountRouteFile(normalized, routePath)
                  const relative = path
                    .relative(process.cwd(), normalized)
                    .replace(/\\/g, '/')
                  console.log(
                    ` ${cc.green}✓${cc.reset} Lazy loaded ${cc.cyan}${relative}${cc.reset}`
                  )
                } catch (err) {
                  formatDevError(err as Error, normalized)
                  return
                }
                await this.app.getRouter().handle(req, res, next)
              } else {
                next?.()
              }
            }

            const lazyRouter = new Router()
            lazyRouter.all(routePath, lazyHandler)
            lazyRouter.all(routePath + '/*path', lazyHandler)
            for (const r of lazyRouter.getRoutes()) {
              r.sourceFile = 'lazy:' + lazyKey
              this.app.getRouter().addRawRoute(r)
            }
          } else {
            try {
              await this.mountRouteFile(normalized, routePath)
            } catch (err) {
              this.app.log.error(
                { err, file: filePath },
                `Failed to load route file: ${filePath}`
              )
            }
          }
        }
      }
    }

    if (!this.hasGateways && !isProd) {
      console.warn(
        '\x1b[33m[ExisJS] Warning: No gateway.ts found — applying default security headers.\x1b[0m'
      )
    }
  }

  // ─── Route File Mounting (shared by autoMount and HotReloader) ──────────────

  // ─── Auto-Mount File-Based Jobs ──────────────────────────────────────────────

  public async autoMountJobs(root: string): Promise<void> {
    if (!this.app._queueWorker) return

    const fs = await import('node:fs/promises')
    const path = await import('node:path')

    const isProd = process.env.NODE_ENV === 'production'
    const searchDirs = isProd
      ? [
          path.join(root, '.exis', 'server', 'src', 'jobs'),
          path.join(root, '.exis', 'server', 'jobs'),
          path.join(root, 'dist', 'src', 'jobs'),
          path.join(root, 'dist', 'jobs'),
          path.join(root, 'src', 'jobs'),
          path.join(root, 'jobs'),
        ]
      : [path.join(root, 'src', 'jobs'), path.join(root, 'jobs')]

    let jobsDir = ''
    for (const dir of searchDirs) {
      try {
        const stat = await fs.stat(dir)
        if (stat.isDirectory()) {
          jobsDir = dir
          break
        }
      } catch {
        /* ignore */
      }
    }

    if (!jobsDir) return

    try {
      const entries = await fs.readdir(jobsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (
          entry.isFile() &&
          (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))
        ) {
          const filePath = path.join(jobsDir, entry.name)
          const name = entry.name.replace(/\.(ts|js)$/, '')

          try {
            // Load the definition directly (no compilation needed here just to get the schema)
            const mod = await import(filePath)
            const jobDef = mod.default || mod

            if (jobDef) {
              const def = {
                name: jobDef.name || name,
                filePath, // Attach filePath for Thread Pool execution
                cron: jobDef.cron,
                schema: jobDef.schema,
                defaultOptions: jobDef.defaultOptions,
              }
              this.app._queueWorker.registerJob(def)

              if (this.app._cronScheduler && jobDef.cron) {
                this.app._cronScheduler.registerJob(def)
              }
              this.app.log.info(`Registered background job: ${name}`)
            }
          } catch (err) {
            this.app.log.error(`Failed to load job file ${filePath}: ${err}`)
          }
        }
      }
    } catch {
      // Ignore if jobs directory does not exist
    }
  }

  async mountRouteFile(filePath: string, routePath: string): Promise<void> {
    let mod: any
    try {
      const url =
        process.env.VITEST || process.env.NODE_ENV === 'test'
          ? pathToFileURL(filePath).href
          : pathToFileURL(filePath).href + '?t=' + Date.now()

      if (process.env.VITEST || process.env.NODE_ENV === 'test') {
        mod = await import(url)
      } else {
        const dynamicImport = new Function(
          'specifier',
          'return import(specifier)'
        )
        mod = await dynamicImport(url)
      }
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require(filePath)
    }

    const path = await import('node:path')
    const fs = await import('node:fs/promises')

    const dirname = path.dirname(filePath)
    const apiDir = this.apiDir || dirname

    const normDirname = path.resolve(dirname).replace(/\\/g, '/').toLowerCase()
    const normApiDir = path.resolve(apiDir).replace(/\\/g, '/').toLowerCase()

    const segments = normDirname.startsWith(normApiDir)
      ? normDirname.slice(normApiDir.length).split('/').filter(Boolean)
      : []

    const allMiddlewares: any[] = []
    const allFilters: any[] = []
    const allGuards: any[] = []
    const allInterceptors: any[] = []
    let allMetadata: Record<string, any> = {}
    let allCors: any = undefined
    let allHeaders: Record<string, string> = {}
    const activeGateways: string[] = []

    const dirsToCheck = [apiDir]
    let tempDir = apiDir
    for (const segment of segments) {
      tempDir = path.join(tempDir, segment)
      dirsToCheck.push(tempDir)
    }

    for (const dir of dirsToCheck) {
      try {
        const gwPathJs = path.join(dir, 'gateway.js')
        const gwPathTs = path.join(dir, 'gateway.ts')

        let targetGw = ''
        if (await fs.stat(gwPathTs).catch(() => null)) targetGw = gwPathTs
        else if (await fs.stat(gwPathJs).catch(() => null)) targetGw = gwPathJs

        if (targetGw) {
          activeGateways.push(targetGw)
          this.hasGateways = true
          const gwUrl =
            process.env.VITEST || process.env.NODE_ENV === 'test'
              ? pathToFileURL(targetGw).href
              : pathToFileURL(targetGw).href + '?t=' + Date.now()
          let gwMod: any
          try {
            if (process.env.VITEST || process.env.NODE_ENV === 'test') {
              gwMod = await import(gwUrl)
            } else {
              const dynamicImportGw = new Function(
                'specifier',
                'return import(specifier)'
              )
              gwMod = await dynamicImportGw(gwUrl)
            }
          } catch {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            gwMod = require(targetGw)
          }
          const gwConfig =
            gwMod && gwMod.default && gwMod.default.default
              ? gwMod.default.default
              : gwMod && gwMod.default
                ? gwMod.default
                : gwMod
          if (gwConfig) {
            const isExcluded = (reqPath: string, reqMethod: string) => {
              if (!gwConfig.exclude) return false
              for (const rule of gwConfig.exclude) {
                if (typeof rule === 'string') {
                  if (rule.endsWith('/*')) {
                    if (reqPath.startsWith(rule.slice(0, -2))) return true
                  } else if (reqPath === rule) return true
                } else {
                  const pathMatch = rule.path.endsWith('/*')
                    ? reqPath.startsWith(rule.path.slice(0, -2))
                    : reqPath === rule.path
                  if (pathMatch) {
                    if (
                      !rule.methods ||
                      rule.methods.includes(reqMethod as any)
                    )
                      return true
                  }
                }
              }
              return false
            }

            if (gwConfig.middleware) {
              const wrapped = gwConfig.middleware.map(
                (m: any) => (req: any, res: any, next: any) =>
                  isExcluded(req.path, req.method) ? next() : m(req, res, next)
              )
              allMiddlewares.push(...wrapped)
            }
            if (gwConfig.filters) {
              const wrapped = gwConfig.filters.map(
                (f: any) => (err: any, req: any, res: any, next: any) =>
                  isExcluded(req.path, req.method)
                    ? next(err)
                    : f.prototype && f.prototype.catch
                      ? new f().catch(err, req, res, next)
                      : f(err, req, res, next)
              )
              allFilters.push(...wrapped)
            }
            if (gwConfig.guards) {
              const wrapped = gwConfig.guards.map((g: any) => {
                return async (req: any) => {
                  if (isExcluded(req.path, req.method)) return true
                  return typeof g === 'function'
                    ? g.prototype?.canActivate
                      ? new g().canActivate(req)
                      : g(req)
                    : g.canActivate(req)
                }
              })
              allGuards.push(...wrapped)
            }
            if (gwConfig.interceptors) {
              const wrapped = gwConfig.interceptors.map((i: any) => {
                return async (req: any, res: any) => {
                  if (isExcluded(req.path, req.method)) return
                  return typeof i === 'function'
                    ? i.prototype?.intercept
                      ? new i().intercept(req, res)
                      : i(req, res)
                    : i.intercept(req, res)
                }
              })
              allInterceptors.push(...wrapped)
            }
            if (gwConfig.timeout !== undefined) {
              const baseTimeout = gwConfig.timeout
              const timeoutMiddleware = (req: any, res: any, next: any) => {
                if (isExcluded(req.path, req.method)) return next()
                const ms =
                  typeof baseTimeout === 'function'
                    ? baseTimeout(req)
                    : baseTimeout
                if (ms) {
                  req.timeoutTimer = setTimeout(() => {
                    if (!res.headersSent) {
                      res.status(408).json({
                        success: false,
                        error: {
                          code: 'REQUEST_TIMEOUT',
                          message: 'Request Timeout',
                        },
                      })
                    }
                  }, ms)
                  res.raw.on('finish', () => clearTimeout(req.timeoutTimer))
                }
                next()
              }
              allMiddlewares.push(timeoutMiddleware)
            }
            if (gwConfig.metadata) {
              allMetadata = { ...allMetadata, ...gwConfig.metadata }
            }
            if (gwConfig.cors !== undefined) allCors = gwConfig.cors
            if (gwConfig.headers)
              allHeaders = { ...allHeaders, ...gwConfig.headers }
            if (gwConfig.plugins) {
              for (const plugin of gwConfig.plugins) {
                await this.app.pluginManager.register(plugin)
              }
            }
            if (gwConfig.imports) {
              for (const mod of gwConfig.imports) {
                const name = 'plugin' in mod ? mod.plugin.name : mod.name
                if (!this.app.pluginManager.hasPlugin(name)) {
                  await this.app.pluginManager.register(mod)
                }
              }
            }
            if (gwConfig.providers) {
              for (const [token, providerConfig] of gwConfig.providers) {
                this.app.container.provide(token, providerConfig)
              }
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    const currentMod =
      mod && mod.default && mod.default.default
        ? mod.default.default
        : mod && mod.default
          ? mod.default
          : mod

    const isControllerObj = currentMod && currentMod.__isController === true
    const routeConfig: any = {
      ...(isControllerObj ? currentMod : {}),
      ...(mod.config || {}),
    }

    // Fallback to global app.options.cors if neither gateway nor route specify it
    if (routeConfig.cors !== undefined) allCors = routeConfig.cors
    else if (allCors === undefined && this.app.options.cors !== undefined)
      allCors = this.app.options.cors

    if (routeConfig.middleware)
      allMiddlewares.push(
        ...(Array.isArray(routeConfig.middleware)
          ? routeConfig.middleware
          : [routeConfig.middleware])
      )
    if (routeConfig.headers)
      allHeaders = { ...allHeaders, ...routeConfig.headers }
    if (routeConfig.plugins) {
      for (const plugin of routeConfig.plugins) {
        await this.app.pluginManager.register(plugin)
      }
    }

    // Pass gateway features to controllers via metadata if necessary
    const combinedFilters = [
      ...allFilters,
      ...(routeConfig.filters
        ? Array.isArray(routeConfig.filters)
          ? routeConfig.filters
          : [routeConfig.filters]
        : []),
    ]
    const combinedGuards = [
      ...allGuards,
      ...(routeConfig.guards
        ? Array.isArray(routeConfig.guards)
          ? routeConfig.guards
          : [routeConfig.guards]
        : []),
    ]
    const combinedInterceptors = [
      ...allInterceptors,
      ...(routeConfig.interceptors
        ? Array.isArray(routeConfig.interceptors)
          ? routeConfig.interceptors
          : [routeConfig.interceptors]
        : []),
    ]

    // Inject into the default export if it's a functional controller
    if (mod.default && typeof mod.default === 'object') {
      try {
        if (!mod.default.filters) mod.default.filters = []
        mod.default.filters.push(...combinedFilters)

        if (!mod.default.guards) mod.default.guards = []
        mod.default.guards.push(...combinedGuards)

        if (!mod.default.interceptors) mod.default.interceptors = []
        mod.default.interceptors.push(...combinedInterceptors)

        if (!mod.default.metadata) mod.default.metadata = {}
        Object.assign(mod.default.metadata, {
          ...allMetadata,
          ...(routeConfig.metadata || {}),
        })
      } catch {
        // If mod.default is frozen, ignore
      }
    }

    const prefixMiddlewares: any[] = []

    if (this.app.options.debugRouting) {
      const pathLib = await import('node:path')
      const relFile = pathLib
        .relative(process.cwd(), filePath)
        .replace(/\\/g, '/')
      const gwStr =
        activeGateways.length > 0
          ? activeGateways
              .map((g: string) =>
                pathLib.relative(process.cwd(), g).replace(/\\/g, '/')
              )
              .join(' -> ') + ' -> '
          : ''

      prefixMiddlewares.push((req: any, res: any, next: any) => {
        this.app.log.debug(
          `[Request] ${req.method} ${req.path} -> ${gwStr}${relFile}`
        )
        next()
      })
    }

    if (allCors !== undefined) {
      if (allCors === true) prefixMiddlewares.push(cors({}))
      else if (allCors !== false) prefixMiddlewares.push(cors(allCors))
    }

    if (Object.keys(allHeaders).length > 0) {
      prefixMiddlewares.push((req: any, res: any, next: any) => {
        for (const [k, v] of Object.entries(allHeaders))
          res.setHeader(k, v as string)
        next()
      })
    }
    prefixMiddlewares.push(...allMiddlewares)

    const isRouter = (obj: unknown) =>
      obj && 'handle' in (obj as object) && 'get' in (obj as object)

    const CONTROLLER_PREFIX = Symbol.for('exisjs:controller_prefix')
    const isController = (obj: any) =>
      obj && obj.prototype && obj.prototype[CONTROLLER_PREFIX] !== undefined

    const unwrappedMod =
      mod && mod.default && mod.default.default
        ? mod.default.default
        : mod && mod.default
          ? mod.default
          : mod
    const functionalControllerObj =
      unwrappedMod && unwrappedMod.__isController ? unwrappedMod : null

    if (functionalControllerObj) {
      // ─── THE NEW PERFECT FUNCTIONAL CONTROLLER ───
      const compiledRouter = this.compileFunctionalController(
        functionalControllerObj
      )
      this.mountRouteWithSource(
        routePath,
        compiledRouter,
        filePath,
        prefixMiddlewares
      )
    } else if (mod.router && isRouter(mod.router)) {
      this.mountRouteWithSource(
        routePath,
        mod.router,
        filePath,
        prefixMiddlewares
      )
    } else if (unwrappedMod && isController(unwrappedMod)) {
      this.app.registerControllers([unwrappedMod], routePath, prefixMiddlewares)
    } else if (unwrappedMod && isRouter(unwrappedMod)) {
      this.mountRouteWithSource(
        routePath,
        unwrappedMod,
        filePath,
        prefixMiddlewares
      )
    } else if (isRouter(mod)) {
      this.mountRouteWithSource(routePath, mod, filePath, prefixMiddlewares)
    } else {
      this.app.log.warn(
        `\n[WARN] Route file \x1b[36m${filePath}\x1b[0m does not export a recognized router or controller.\n`
      )
    }
  }

  private compileFunctionalController(
    config: any
  ): import('../router/router').Router {
    const router = new Router()

    const fileMiddleware: any[] = []
    if (config.cors) {
      fileMiddleware.push(config.cors === true ? cors({}) : cors(config.cors))
    }
    if (config.middleware) {
      fileMiddleware.push(
        ...(Array.isArray(config.middleware)
          ? config.middleware
          : [config.middleware])
      )
    }

    const { onError, onResponse } = config

    for (const [key, routeConfig] of Object.entries(config)) {
      if (
        [
          'cors',
          'middleware',
          'onError',
          'onResponse',
          '__isController',
        ].includes(key)
      )
        continue

      const rc = routeConfig as any
      if (!rc || !rc.method || !rc.path || !rc.handle) continue

      const routeMiddlewares = [...fileMiddleware]

      if (rc.cors) {
        routeMiddlewares.push(rc.cors === true ? cors({}) : cors(rc.cors))
      }
      if (rc.middleware) {
        routeMiddlewares.push(
          ...(Array.isArray(rc.middleware) ? rc.middleware : [rc.middleware])
        )
      }

      // ─── SUPER HANDLER WRAPPER ───
      const superHandler = async (req: any, res: any, next: any) => {
        if (onResponse) {
          res.raw.on('finish', () => onResponse(req, res))
        }

        try {
          // 0. Enforce Route Permissions (Role Authorization)
          if (rc.permissions && rc.permissions.length > 0) {
            if (!req.user) {
              res.status(401).json({
                success: false,
                error: {
                  code: 'UNAUTHORIZED',
                  message: 'Unauthorized: User not found on request',
                },
              })
              return
            }
            const userPerms =
              req.user.permissions || req.user.roles || req.user.role || []
            const permsArray = Array.isArray(userPerms)
              ? userPerms
              : [userPerms]
            const hasPerm = rc.permissions.every((p: string) =>
              permsArray.includes(p)
            )
            if (!hasPerm) {
              res.status(403).json({
                success: false,
                error: {
                  code: 'FORBIDDEN',
                  message: 'Forbidden: Insufficient permissions',
                },
              })
              return
            }
          }

          // 1. Run Guards
          const routeGuards = [...(config.guards || []), ...(rc.guards || [])]
          for (const guard of routeGuards) {
            const allowed = await (typeof guard === 'function'
              ? guard.prototype?.canActivate
                ? new guard().canActivate(req)
                : guard(req)
              : guard.canActivate(req))
            if (!allowed) {
              if (res && !res.headersSent) {
                res.status(403).json({
                  success: false,
                  error: { code: 'FORBIDDEN', message: 'Forbidden by Guard' },
                })
              }
              return
            }
          }

          // Build Context
          const ctx: any = {
            body: req.body,
            query: req.query,
            params: req.params,
            headers: req.headers,
            req,
            res,
            app: this.app,
            resolve: <T>(token: any): T =>
              this.app.resolve(token, (req as any)._diCache),
            socket: (req as any).ws,
            state: executionContext.getStore()?.state || {},
          }
          if (req.user !== undefined) ctx.user = req.user
          if ((req as any).session !== undefined)
            ctx.session = (req as any).session

          const result = await rc.handle(ctx)

          // 2. Run Interceptors
          const routeInterceptors = [
            ...(config.interceptors || []),
            ...(rc.interceptors || []),
          ]
          for (const interceptor of routeInterceptors) {
            await (typeof interceptor === 'function'
              ? interceptor.prototype?.intercept
                ? new interceptor().intercept(req, res)
                : interceptor(req, res)
              : interceptor.intercept(req, res))
          }

          if (result !== undefined && !res.headersSent) {
            if (typeof result === 'object' && result !== null) {
              res.json(result)
            } else {
              res.send(String(result))
            }
          }
        } catch (err) {
          if (onError) {
            try {
              await onError(err, req, res)
            } catch (hookErr) {
              next(hookErr)
            }
          } else {
            next(err) // Hands off to ExisJS global error handler (which handles HttpErrors automatically!)
          }
        }
      }

      // Mount to router
      const method = rc.method.toLowerCase()

      const schema: any = {}

      const isValidatorOrPipe = (v: any) =>
        v.parse ||
        v.transform ||
        (typeof v === 'function' && v.prototype?.transform)

      if (rc.body) {
        schema.body = isValidatorOrPipe(rc.body) ? rc.body : tex.object(rc.body)
      }
      if (rc.query) {
        schema.query = isValidatorOrPipe(rc.query)
          ? rc.query
          : tex.object(rc.query)
      }
      if (rc.params) {
        schema.params = isValidatorOrPipe(rc.params)
          ? rc.params
          : tex.object(rc.params)
      }
      if (rc.host) {
        schema.host = rc.host
      }
      const combinedFilters = [
        ...(config.filters
          ? Array.isArray(config.filters)
            ? config.filters
            : [config.filters]
          : []),
        ...(rc.filters
          ? Array.isArray(rc.filters)
            ? rc.filters
            : [rc.filters]
          : []),
      ]
      if (combinedFilters.length > 0) {
        schema.filters = combinedFilters
      }

      const combinedMetadata = {
        ...(config.metadata || {}),
        ...(rc.metadata || {}),
      }
      if (Object.keys(combinedMetadata).length > 0) {
        schema.metadata = combinedMetadata
      }
      if (method === 'sse') {
        const sseHandler = async (stream: any, rawReq: any) => {
          try {
            const ctx = {
              body: rawReq.body,
              query: rawReq.query,
              params: rawReq.params,
              headers: rawReq.headers,
              req: rawReq,
              res: undefined as any, // Res is not available in standard SSE after handshake
              app: this.app,
              resolve: <T>(token: any): T =>
                this.app.resolve(token, rawReq._diCache),
              stream,
              ...rawReq,
            }
            await rc.handle(ctx)
          } catch (err) {
            if (onError) {
              await onError(err, rawReq, {} as any)
            } else {
              console.error('[Exis SSE Error]', err)
            }
          }
        }
        router.sse(rc.path, ...routeMiddlewares, sseHandler)
      } else {
        if (Object.keys(schema).length > 0) {
          ;(router as any)[method](
            rc.path,
            ...routeMiddlewares,
            schema,
            superHandler
          )
        } else {
          ;(router as any)[method](rc.path, ...routeMiddlewares, superHandler)
        }
      }
    }

    return router
  }

  private mountRouteWithSource(
    prefix: string,
    subRouter: Router,
    sourceFile: string,
    prefixMiddlewares: any[] = []
  ): this {
    for (const route of subRouter.getRoutes()) {
      const fullPath = (prefix + route.path).replace(/\/+/g, '/')
      const r = { ...route, path: fullPath, sourceFile }
      if (prefixMiddlewares.length > 0) {
        r.handlers = [...prefixMiddlewares, ...r.handlers]
      }
      this.app.getRouter().addRawRoute(r)

      if (this.app.pluginManager.hooks.route.length > 0) {
        // eslint-disable-next-line @typescript-eslint/prefer-for-of
        for (let i = 0; i < this.app.pluginManager.hooks.route.length; i++) {
          this.app.pluginManager.hooks.route[i]({
            method: route.method,
            path: fullPath,
          })
        }
      }
    }
    return this
  }

  private async scanDirectory(
    dir: string,
    baseRoute = '/'
  ): Promise<{ filePath: string; routePath: string }[]> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')

    const entries = await fs.readdir(dir, { withFileTypes: true })
    const results: { filePath: string; routePath: string }[] = []

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        let segment = entry.name

        if (segment.startsWith('(') && segment.endsWith(')')) {
          const subResults = await this.scanDirectory(fullPath, baseRoute)
          results.push(...subResults)
          continue
        }

        if (segment.startsWith('[...') && segment.endsWith(']')) {
          segment = '*' + segment.slice(4, -1)
        } else {
          segment = segment.replace(/\[(.*?)\]/g, ':$1')
        }

        const nextBase =
          baseRoute === '/' ? `/${segment}` : `${baseRoute}/${segment}`
        const subResults = await this.scanDirectory(fullPath, nextBase)
        results.push(...subResults)
      } else {
        results.push({ filePath: fullPath, routePath: baseRoute })
      }
    }
    return results
  }
}
