import type { App } from '../server/app'
import { Router } from '../router/router'
import { cors } from '../middleware/middleware'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Handler } from '../types'
import { formatDevError } from '../error/overlay'
import {
  scanDirectory,
  isBoundaryFile,
  isRouteFile,
  loadActiveBoundaries,
  compileFunctionalController,
  mountCronJobs,
  mountCronJobsFromEntries,
  mountErrorHandler,
  mountErrorHandlerFromModule,
} from './scanner'

export class RouteScanner {
  public lazyRoutes = new Map<string, { filePath: string; loaded: boolean }>()
  public routeMap = new Map<string, string>()
  public apiDir: string | null = null
  public _allApiDirs?: string[]
  public hasBoundaries = false
  public globalParadigm: 'oop' | 'functional' | null = null

  constructor(public app: App) {}

  async loadAllRoutes(): Promise<void> {
    for (const [, entry] of this.lazyRoutes.entries()) {
      if (!entry.loaded) {
        entry.loaded = true
        this.app.getRouter().removeRoutesBySource('lazy:' + entry.filePath)
        const routePath = this.routeMap.get(entry.filePath)
        if (routePath) {
          try {
            await this.mountRouteFile(entry.filePath, routePath)
          } catch (e) {
            this.app.log.error(
              { err: e, file: entry.filePath },
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
    let manifestErrorHandler: any = undefined
    let manifestCronJobs: any = undefined

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
          manifestErrorHandler = mod.errorHandler
          manifestCronJobs = mod.cronJobs
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

    const searchDirs = isProd
      ? [
          path.join(root, '.exis', 'server', 'src', 'http'),
          path.join(root, 'src', 'http'),
        ]
      : [path.join(root, 'src', 'http')]

    if (Array.isArray(manifest)) {
      if (manifestErrorHandler !== undefined) {
        if (manifestErrorHandler) {
          this.mountErrorHandlerFromModule(
            manifestErrorHandler,
            'manifest:error'
          )
        }
      } else {
        for (const dir of searchDirs) {
          await this.mountErrorHandler(dir)
        }
      }

      if (Array.isArray(manifestCronJobs)) {
        this.mountCronJobsFromEntries(manifestCronJobs)
      } else {
        await this.mountCronJobs(root)
      }

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

    if (appDirs.length === 0) {
      await this.mountCronJobs(root)
      return
    }

    this.apiDir = appDirs[0] // keep property name for backwards compatibility
    this._allApiDirs = appDirs

    for (const appDir of appDirs) {
      await this.mountErrorHandler(appDir)
      const routes = await this.scanDirectory(appDir)

      for (const { filePath, routePath } of routes) {
        if (isBoundaryFile(filePath)) {
          this.hasBoundaries = true
        }

        if (isRouteFile(filePath)) {
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

    await this.mountCronJobs(root)

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

    const docsConfig = this.app.options.docs || this.app.options.swagger
    if (
      docsConfig &&
      (typeof docsConfig === 'boolean'
        ? docsConfig
        : docsConfig.enabled !== false)
    ) {
      const { mountDocumentation } = await import('../swagger/mounter.js')
      mountDocumentation(
        this.app,
        typeof docsConfig === 'object' ? docsConfig : {}
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

    const {
      activeBoundaries,
      boundaryMiddlewares,
      boundaryFilters,
      boundaryGuards,
      boundaryInterceptors,
      boundaryMetadata,
      boundaryCors,
      boundaryHeaders,
      hasBoundaries,
    } = await loadActiveBoundaries(
      filePath,
      this.apiDir || path.dirname(filePath),
      this.app
    )

    if (hasBoundaries) {
      this.hasBoundaries = true
    }

    const allMiddlewares = [...boundaryMiddlewares]
    let allCors = boundaryCors
    let allHeaders = { ...boundaryHeaders }

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
    if (rMiddleware) {
      allMiddlewares.push(
        ...(Array.isArray(rMiddleware) ? rMiddleware : [rMiddleware])
      )
    }
    if (routeConfig.headers) {
      allHeaders = { ...allHeaders, ...routeConfig.headers }
    }
    if (routeConfig.plugins) {
      for (const plugin of routeConfig.plugins) {
        await this.app.pluginManager.register(plugin)
      }
    }

    // Pass boundary features to controllers via metadata if necessary
    const combinedFilters = [
      ...boundaryFilters,
      ...(routeConfig.filters
        ? Array.isArray(routeConfig.filters)
          ? routeConfig.filters
          : [routeConfig.filters]
        : []),
    ]
    const combinedGuards = [
      ...boundaryGuards,
      ...(routeConfig.guards
        ? Array.isArray(routeConfig.guards)
          ? routeConfig.guards
          : [routeConfig.guards]
        : []),
    ]
    const combinedInterceptors = [
      ...boundaryInterceptors,
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
          ...boundaryMetadata,
          ...(routeConfig.metadata || {}),
        })
      } catch {
        // If mod.default is frozen, ignore
      }
    }

    const prefixMiddlewares: any[] = []

    if (this.app.options.debugRouting) {
      const relFile = path.relative(process.cwd(), filePath).replace(/\\/g, '/')
      const boundaryStr =
        activeBoundaries.length > 0
          ? activeBoundaries
              .map((g: string) =>
                path.relative(process.cwd(), g).replace(/\\/g, '/')
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

  private compileFunctionalController(config: any): Router {
    return compileFunctionalController(config, this.app)
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

  public mountErrorHandlerFromModule(mod: any, errorFile = 'error.ts'): void {
    mountErrorHandlerFromModule(mod, this.app, errorFile)
  }

  private async mountErrorHandler(dir: string): Promise<void> {
    await mountErrorHandler(dir, this.app)
  }

  private async scanDirectory(
    dir: string,
    baseRoute = '/'
  ): Promise<{ filePath: string; routePath: string }[]> {
    return scanDirectory(dir, baseRoute)
  }

  public async mountCronJobs(root: string): Promise<void> {
    await mountCronJobs(root, this.app, this._allApiDirs)
  }

  public mountCronJobsFromEntries(
    entries: { filePath: string; module: any }[]
  ): void {
    mountCronJobsFromEntries(entries, this.app)
  }
}
