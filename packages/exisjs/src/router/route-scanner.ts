import type { App } from '../server/app'
import { Router } from '../router/router'
import { cors } from '../middleware/middleware'
import { tex } from '../validator/index'
import { pathToFileURL } from 'node:url'
import { executionContext } from '../server/context'
import type { Handler } from '../types'
import { formatDevError } from '../dev/error-overlay'

export class RouteScanner {
  public lazyRoutes = new Map<string, { filePath: string; loaded: boolean }>()
  public routeMap = new Map<string, string>()
  public apiDir: string | null = null
  public _allApiDirs?: string[]
  public hasBoundaries = false
  public globalParadigm: 'oop' | 'functional' | null = null

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

    try {
      const { registerPathAliasLoader } =
        await import('../cli/resolve-aliases.js')
      registerPathAliasLoader(root)
    } catch {
      // ignore
    }

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
          this.app.log.warn(
            { err: err.message },
            'Failed to load routes manifest'
          )
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
          if (this.globalParadigm === 'oop') {
            this.app.log.error(
              `Mixed Paradigm Error: File ${filePath} uses a Functional controller, but the app is already using Class-Based (OOP) controllers. Please use a single paradigm for the entire project.`
            )
            process.exit(1)
          }
          this.globalParadigm = 'functional'
          const router = this.compileFunctionalController(
            functionalControllerObj
          )
          this.mountRouteWithSource(routePath, router, normalizedPath)
        } else if (isClassController(routerInstance)) {
          if (this.globalParadigm === 'functional') {
            this.app.log.error(
              `Mixed Paradigm Error: File ${filePath} uses a Class-Based (OOP) controller, but the app is already using Functional controllers. Please use a single paradigm for the entire project.`
            )
            process.exit(1)
          }
          this.globalParadigm = 'oop'
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
          path.join(root, 'dist', 'src', 'http'),
          path.join(root, 'src', 'http'),
        ]
      : [path.join(root, 'src', 'http')]

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

    for (const appDir of appDirs) {
      const routes = await this.scanDirectory(appDir)

      for (const { filePath, routePath } of routes) {
        const isBoundaryFile =
          filePath.endsWith('boundary.ts') ||
          filePath.endsWith('boundary.js') ||
          /\.boundary\.[jt]s$/.test(filePath)

        if (isBoundaryFile) {
          this.hasBoundaries = true
        }

        const isRouteFile =
          filePath.endsWith('route.ts') ||
          filePath.endsWith('route.js') ||
          /\.route\.[jt]s$/.test(filePath)

        if (isRouteFile) {
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

    // ─── Eager Paradigm Validation ──────────────────────────────────────────────
    // Even in dev mode (lazy routes), pre-scan all route files at startup to
    // detect mixed paradigms (OOP + functional) and throw a fatal error immediately.
    if (isDev && this.globalParadigm === null) {
      const CONTROLLER_PREFIX = Symbol.for('exisjs:controller_prefix')
      const routeFiles = [...this.routeMap.keys()]
      const oopFiles: string[] = []
      const functionalFiles: string[] = []
      const dynamicImport = new Function(
        'specifier',
        'return import(specifier)'
      )

      for (const file of routeFiles) {
        try {
          const url = pathToFileURL(file).href
          const mod = await dynamicImport(url)
          const unwrapped =
            mod && mod.default && mod.default.default
              ? mod.default.default
              : mod && mod.default
                ? mod.default
                : mod

          if (unwrapped && unwrapped.__isController) {
            functionalFiles.push(file)
          } else if (
            unwrapped &&
            unwrapped.prototype &&
            unwrapped.prototype[CONTROLLER_PREFIX] !== undefined
          ) {
            oopFiles.push(file)
          }
        } catch {
          // Skip files that fail to import (TS errors will be caught by tsc)
        }
      }

      if (oopFiles.length > 0 && functionalFiles.length > 0) {
        const path = await import('node:path')
        const cwd = process.cwd()
        const formatFiles = (files: string[]) =>
          files
            .map((f) => `    → ${path.relative(cwd, f).replace(/\\/g, '/')}`)
            .join('\n')

        this.app.log.error(
          `Mixed Paradigm Error: A project can only use one controller paradigm (OOP or Functional). Mixing them is not supported.\n\n` +
            `Class-Based (OOP) controllers found in:\n${formatFiles(oopFiles)}\n\n` +
            `Functional controllers found in:\n${formatFiles(functionalFiles)}\n\n` +
            `Fix: Choose one paradigm and update the files to match.`
        )
        process.exit(1)
      }

      if (oopFiles.length > 0) this.globalParadigm = 'oop'
      else if (functionalFiles.length > 0) this.globalParadigm = 'functional'
    }

    if (!this.hasBoundaries && !isProd) {
      this.app.log.warn(
        'No boundary.ts found — applying default security headers.'
      )
    }
  }

  // ─── Route File Mounting (shared by autoMount and HotReloader) ──────────────

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
    const activeBoundaries: string[] = []

    const dirsToCheck = [apiDir]
    let tempDir = apiDir
    for (const segment of segments) {
      tempDir = path.join(tempDir, segment)
      dirsToCheck.push(tempDir)
    }

    for (const dir of dirsToCheck) {
      try {
        // Detect deprecated gateway.ts / gateway.js
        const gatewayPathTs = path.join(dir, 'gateway.ts')
        const gatewayPathJs = path.join(dir, 'gateway.js')
        if (
          (await fs.stat(gatewayPathTs).catch(() => null)) ||
          (await fs.stat(gatewayPathJs).catch(() => null))
        ) {
          this.app.log.warn(
            `Found deprecated 'gateway' file in '${dir}'. Gateways have been renamed to 'boundary.ts' in ExisJS v0.7+. Please rename it to boundary.ts.`
          )
        }

        const boundaryPathTs = path.join(dir, 'boundary.ts')
        const boundaryPathJs = path.join(dir, 'boundary.js')
        let targetBoundary = ''
        if (await fs.stat(boundaryPathTs).catch(() => null))
          targetBoundary = boundaryPathTs
        else if (await fs.stat(boundaryPathJs).catch(() => null))
          targetBoundary = boundaryPathJs
        else {
          // Check for named boundaries like user.boundary.ts
          const dirFiles = await fs.readdir(dir).catch(() => [])
          const namedBoundary = dirFiles.find((f: string) =>
            /\.boundary\.[jt]s$/.test(f)
          )
          if (namedBoundary) {
            targetBoundary = path.join(dir, namedBoundary)
          }
        }

        if (targetBoundary) {
          activeBoundaries.push(targetBoundary)
          this.hasBoundaries = true
          const boundaryUrl =
            process.env.VITEST || process.env.NODE_ENV === 'test'
              ? pathToFileURL(targetBoundary).href
              : pathToFileURL(targetBoundary).href + '?t=' + Date.now()
          let boundaryMod: any
          try {
            if (process.env.VITEST || process.env.NODE_ENV === 'test') {
              boundaryMod = await import(boundaryUrl)
            } else {
              const dynamicImportBoundary = new Function(
                'specifier',
                'return import(specifier)'
              )
              boundaryMod = await dynamicImportBoundary(boundaryUrl)
            }
          } catch {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            boundaryMod = require(targetBoundary)
          }

          // Extract config: check boundaryMod.config, boundaryMod.default, or boundaryMod itself
          let boundaryConfig: any = null
          const BOUNDARY_CONFIG = Symbol.for('exisjs:boundary_config')
          const boundaryDefault =
            boundaryMod && boundaryMod.default && boundaryMod.default.default
              ? boundaryMod.default.default
              : boundaryMod && boundaryMod.default
                ? boundaryMod.default
                : null

          if (
            boundaryMod &&
            boundaryMod.config &&
            typeof boundaryMod.config === 'object'
          ) {
            boundaryConfig = boundaryMod.config
          } else if (
            boundaryDefault &&
            typeof boundaryDefault === 'function' &&
            boundaryDefault.prototype &&
            boundaryDefault.prototype[BOUNDARY_CONFIG]
          ) {
            // Class-based boundary with @Boundary
            boundaryConfig = boundaryDefault.prototype[BOUNDARY_CONFIG]
          } else if (boundaryDefault && typeof boundaryDefault === 'object') {
            boundaryConfig = boundaryDefault
          } else if (boundaryMod && typeof boundaryMod === 'object') {
            boundaryConfig = boundaryMod
          }
          const isExcluded = (reqPath: string, reqMethod: string) => {
            if (!boundaryConfig || !boundaryConfig.exclude) return false
            for (const rule of boundaryConfig.exclude) {
              if (typeof rule === 'string') {
                if (rule.endsWith('/*')) {
                  if (reqPath.startsWith(rule.slice(0, -2))) return true
                } else if (reqPath === rule) return true
              } else {
                const pathMatch = rule.path.endsWith('/*')
                  ? reqPath.startsWith(rule.path.slice(0, -2))
                  : reqPath === rule.path
                if (pathMatch) {
                  const methods =
                    rule.methods || (rule.method ? [rule.method] : undefined)
                  if (!methods || methods.includes(reqMethod as any))
                    return true
                }
              }
            }
            return false
          }

          // 1. Auto-detect named middleware functions: (req, res, next)
          if (boundaryMod && typeof boundaryMod === 'object') {
            for (const [exportKey, exportVal] of Object.entries(boundaryMod)) {
              if (
                exportKey !== 'default' &&
                exportKey !== 'config' &&
                typeof exportVal === 'function' &&
                exportVal.length >= 3 // (req, res, next)
              ) {
                const namedMiddleware = (req: any, res: any, next: any) =>
                  isExcluded(req.path, req.method)
                    ? next()
                    : (exportVal as any)(req, res, next)
                allMiddlewares.push(namedMiddleware)
              }
            }
          }

          // 2. Auto-detect pipeline wrapper function: export default async function(ctx, next)
          // or class method named `handle(ctx, next)`
          let wrapperFn:
            ((ctx: any, next: () => Promise<any>) => Promise<any>) | null = null
          if (
            boundaryDefault &&
            typeof boundaryDefault === 'function' &&
            boundaryDefault.length === 2 &&
            !boundaryDefault.prototype?.[BOUNDARY_CONFIG]
          ) {
            wrapperFn = boundaryDefault
          } else if (
            boundaryDefault &&
            typeof boundaryDefault === 'function' &&
            boundaryDefault.prototype &&
            boundaryDefault.prototype[BOUNDARY_CONFIG]
          ) {
            const proto = boundaryDefault.prototype
            if (typeof proto.handle === 'function') {
              const boundaryInstance = new boundaryDefault()
              wrapperFn = proto.handle.bind(boundaryInstance)
            }
            // Also inspect method middlewares on class boundary
            for (const prop of Object.getOwnPropertyNames(proto)) {
              if (prop !== 'constructor' && prop !== 'handle') {
                const methodVal = proto[prop]
                if (typeof methodVal === 'function' && methodVal.length >= 3) {
                  const boundaryInstance = new boundaryDefault()
                  const namedMiddleware = (req: any, res: any, next: any) =>
                    isExcluded(req.path, req.method)
                      ? next()
                      : methodVal.call(boundaryInstance, req, res, next)
                  allMiddlewares.push(namedMiddleware)
                }
              }
            }
          }

          if (wrapperFn) {
            const capturedWrapper = wrapperFn
            const wrapperMiddleware = (req: any, res: any, next: any) => {
              if (isExcluded(req.path, req.method)) return next()

              let nextCalled = false
              let nextResolve: (val: any) => void
              let _nextReject: (err: any) => void
              const nextPromise = new Promise((resolve, reject) => {
                nextResolve = resolve
                _nextReject = reject
              })

              // Intercept response methods to catch handler return values
              const originalJson = res.json.bind(res)
              const originalSend = res.send.bind(res)
              let handledByRoute = false

              res.json = function (body: any) {
                if (!handledByRoute) {
                  handledByRoute = true
                  nextResolve(body)
                } else {
                  return originalJson(body)
                }
                return this
              }
              res.send = function (body: any) {
                if (!handledByRoute) {
                  handledByRoute = true
                  nextResolve(body)
                } else {
                  return originalSend(body)
                }
                return this
              }

              const ctx = {
                req,
                res,
                app: this.app,
                resolve: <T>(token: any): T =>
                  this.app.resolve(token, (req as any)._diCache),
              }

              capturedWrapper(ctx, async () => {
                if (!nextCalled) {
                  nextCalled = true
                  next()
                }
                return nextPromise
              })
                .then((wrapperResult: any) => {
                  if (wrapperResult !== undefined && !res.headersSent) {
                    if (
                      typeof wrapperResult === 'object' &&
                      wrapperResult !== null
                    ) {
                      originalJson(wrapperResult)
                    } else {
                      originalSend(String(wrapperResult))
                    }
                  }
                })
                .catch((wrapperErr: any) => {
                  next(wrapperErr)
                })
            }
            allMiddlewares.push(wrapperMiddleware)
          }

          if (boundaryConfig) {
            const bMiddleware =
              boundaryConfig.middleware || boundaryConfig.middlewares
            if (bMiddleware) {
              const mList = Array.isArray(bMiddleware)
                ? bMiddleware
                : [bMiddleware]
              const wrapped = mList.map(
                (m: any) => (req: any, res: any, next: any) =>
                  isExcluded(req.path, req.method) ? next() : m(req, res, next)
              )
              allMiddlewares.push(...wrapped)
            }
            if (boundaryConfig.filters) {
              const wrapped = boundaryConfig.filters.map(
                (f: any) => (err: any, req: any, res: any, next: any) =>
                  isExcluded(req.path, req.method)
                    ? next(err)
                    : f.prototype && f.prototype.catch
                      ? new f().catch(err, req, res, next)
                      : f(err, req, res, next)
              )
              allFilters.push(...wrapped)
            }
            if (boundaryConfig.guards) {
              const wrapped = boundaryConfig.guards.map((g: any) => {
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
            if (boundaryConfig.interceptors) {
              const wrapped = boundaryConfig.interceptors.map((i: any) => {
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
            if (boundaryConfig.timeout !== undefined) {
              const baseTimeout = boundaryConfig.timeout
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
            if (boundaryConfig.metadata) {
              allMetadata = { ...allMetadata, ...boundaryConfig.metadata }
            }
            if (boundaryConfig.cors !== undefined) allCors = boundaryConfig.cors
            if (boundaryConfig.headers)
              allHeaders = { ...allHeaders, ...boundaryConfig.headers }
            if (boundaryConfig.plugins) {
              for (const plugin of boundaryConfig.plugins) {
                await this.app.pluginManager.register(plugin)
              }
            }
            if (boundaryConfig.imports) {
              for (const mod of boundaryConfig.imports) {
                const name = 'plugin' in mod ? mod.plugin.name : mod.name
                if (!this.app.pluginManager.hasPlugin(name)) {
                  await this.app.pluginManager.register(mod)
                }
              }
            }
            if (boundaryConfig.providers) {
              for (const [token, providerConfig] of boundaryConfig.providers) {
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

    // Fallback to global app.options.cors if neither boundary nor route specify it
    if (routeConfig.cors !== undefined) allCors = routeConfig.cors
    else if (allCors === undefined && this.app.options.cors !== undefined)
      allCors = this.app.options.cors

    const rMiddleware = routeConfig.middleware || routeConfig.middlewares
    if (rMiddleware)
      allMiddlewares.push(
        ...(Array.isArray(rMiddleware) ? rMiddleware : [rMiddleware])
      )
    if (routeConfig.headers)
      allHeaders = { ...allHeaders, ...routeConfig.headers }
    if (routeConfig.plugins) {
      for (const plugin of routeConfig.plugins) {
        await this.app.pluginManager.register(plugin)
      }
    }

    // Pass boundary features to controllers via metadata if necessary
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
      const boundaryStr =
        activeBoundaries.length > 0
          ? activeBoundaries
              .map((g: string) =>
                pathLib.relative(process.cwd(), g).replace(/\\/g, '/')
              )
              .join(' -> ') + ' -> '
          : ''

      prefixMiddlewares.push((req: any, res: any, next: any) => {
        this.app.log.debug(
          `[Request] ${req.method} ${req.path} -> ${boundaryStr}${relFile}`
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
      if (this.globalParadigm === 'oop') {
        this.app.log.error(
          `Mixed Paradigm Error: File ${filePath} uses a Functional controller, but the app is already using Class-Based (OOP) controllers. Please use a single paradigm for the entire project.`
        )
        process.exit(1)
      }
      this.globalParadigm = 'functional'
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
      if (this.globalParadigm === 'functional') {
        this.app.log.error(
          `Mixed Paradigm Error: File ${filePath} uses a Class-Based (OOP) controller, but the app is already using Functional controllers. Please use a single paradigm for the entire project.`
        )
        process.exit(1)
      }
      this.globalParadigm = 'oop'
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
    const fileMiddlewareConfig = config.middleware || config.middlewares
    if (fileMiddlewareConfig) {
      fileMiddleware.push(
        ...(Array.isArray(fileMiddlewareConfig)
          ? fileMiddlewareConfig
          : [fileMiddlewareConfig])
      )
    }

    const { onError, onResponse } = config

    for (const [key, routeConfig] of Object.entries(config)) {
      if (
        [
          'cors',
          'middleware',
          'middlewares',
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
      const rcMiddleware = rc.middleware || rc.middlewares
      if (rcMiddleware) {
        routeMiddlewares.push(
          ...(Array.isArray(rcMiddleware) ? rcMiddleware : [rcMiddleware])
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
