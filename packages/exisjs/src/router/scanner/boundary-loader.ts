import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import type { App } from '../../server/app'

export interface LoadedBoundaryPipeline {
  activeBoundaries: string[]
  boundaryMiddlewares: any[]
  boundaryFilters: any[]
  boundaryGuards: any[]
  boundaryInterceptors: any[]
  boundaryMetadata: Record<string, any>
  boundaryCors?: any
  boundaryHeaders: Record<string, string>
  hasBoundaries: boolean
}

/**
 * Traverses directory ancestry from `apiDir` down to `filePath` directory,
 * loading and compiling all intermediate `boundary.ts` files into a unified pipeline.
 */
export async function loadActiveBoundaries(
  filePath: string,
  apiDir: string,
  app: App
): Promise<LoadedBoundaryPipeline> {
  const dirname = path.dirname(filePath)
  const effectiveApiDir = apiDir || dirname

  const normDirname = path.resolve(dirname).replace(/\\/g, '/').toLowerCase()
  const normApiDir = path
    .resolve(effectiveApiDir)
    .replace(/\\/g, '/')
    .toLowerCase()

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
  let hasBoundaries = false

  const dirsToCheck = [effectiveApiDir]
  let tempDir = effectiveApiDir
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
        app.log.warn(
          `Found deprecated 'gateway' file in '${dir}'. Gateways have been renamed to 'boundary.ts' in ExisJS v0.7+. Please rename it to boundary.ts.`
        )
      }

      const boundaryPathTs = path.join(dir, 'boundary.ts')
      const boundaryPathJs = path.join(dir, 'boundary.js')
      let targetBoundary = ''
      if (await fs.stat(boundaryPathTs).catch(() => null)) {
        targetBoundary = boundaryPathTs
      } else if (await fs.stat(boundaryPathJs).catch(() => null)) {
        targetBoundary = boundaryPathJs
      } else {
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
        hasBoundaries = true
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

        if (
          boundaryConfig &&
          boundaryConfig.providers &&
          Array.isArray(boundaryConfig.providers)
        ) {
          for (const p of boundaryConfig.providers) {
            if (Array.isArray(p)) {
              app.container.provide(p[0], p[1])
            } else {
              app.container.provide(p, p)
            }
          }
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
                if (!methods || methods.includes(reqMethod as any)) return true
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
              exportKey !== 'beforeHandle' &&
              exportKey !== 'afterHandle' &&
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
          if (
            typeof boundaryMod.beforeHandle === 'function' &&
            !boundaryConfig?.beforeHandle
          ) {
            if (!boundaryConfig) boundaryConfig = {}
            boundaryConfig.beforeHandle = boundaryMod.beforeHandle
          }
          if (
            typeof boundaryMod.afterHandle === 'function' &&
            !boundaryConfig?.afterHandle
          ) {
            if (!boundaryConfig) boundaryConfig = {}
            boundaryConfig.afterHandle = boundaryMod.afterHandle
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
            if (
              prop !== 'constructor' &&
              prop !== 'handle' &&
              prop !== 'beforeHandle' &&
              prop !== 'afterHandle'
            ) {
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
          if (
            typeof proto.beforeHandle === 'function' &&
            !boundaryConfig?.beforeHandle
          ) {
            const boundaryInstance = new boundaryDefault()
            if (!boundaryConfig) boundaryConfig = {}
            boundaryConfig.beforeHandle =
              proto.beforeHandle.bind(boundaryInstance)
          }
          if (
            typeof proto.afterHandle === 'function' &&
            !boundaryConfig?.afterHandle
          ) {
            const boundaryInstance = new boundaryDefault()
            if (!boundaryConfig) boundaryConfig = {}
            boundaryConfig.afterHandle =
              proto.afterHandle.bind(boundaryInstance)
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
              app,
              resolve: <T>(token: any): T =>
                app.resolve(token, (req as any)._diCache),
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
          if (
            boundaryConfig.blockProbes ||
            boundaryConfig.blockSuspiciousProbes
          ) {
            const probeOpts =
              typeof boundaryConfig.blockProbes === 'object'
                ? boundaryConfig.blockProbes
                : typeof boundaryConfig.blockSuspiciousProbes === 'object'
                  ? boundaryConfig.blockSuspiciousProbes
                  : {}
            const { blockSuspiciousProbes } =
              await import('../../middleware/security')
            allMiddlewares.push(blockSuspiciousProbes(probeOpts))
          }

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
          if (boundaryConfig.beforeHandle || boundaryConfig.afterHandle) {
            const beforeHooks = (
              Array.isArray(boundaryConfig.beforeHandle)
                ? boundaryConfig.beforeHandle
                : boundaryConfig.beforeHandle
                  ? [boundaryConfig.beforeHandle]
                  : []
            ) as ((req: any, res: any) => any)[]

            const afterHooks = (
              Array.isArray(boundaryConfig.afterHandle)
                ? boundaryConfig.afterHandle
                : boundaryConfig.afterHandle
                  ? [boundaryConfig.afterHandle]
                  : []
            ) as ((req: any, res: any, data: any) => any)[]

            const hookMiddleware = async (req: any, res: any, next: any) => {
              if (isExcluded(req.path, req.method)) return next()

              for (const hook of beforeHooks) {
                try {
                  const result = await hook(req, res)
                  if (result === false) {
                    if (!res.headersSent) {
                      res.status(403).json({
                        success: false,
                        error: {
                          code: 'FORBIDDEN',
                          message: 'Forbidden by boundary guard',
                        },
                      })
                    }
                    return
                  }
                  if (res.headersSent) return
                } catch (err) {
                  return next(err)
                }
              }

              if (afterHooks.length === 0) {
                return next()
              }

              const originalJson = res.json.bind(res)
              const originalSend = res.send.bind(res)
              let handled = false

              res.json = function (body: any) {
                if (handled) return originalJson(body)
                handled = true

                const runAfterHooks = async () => {
                  let currentData = body
                  for (const afterHook of afterHooks) {
                    const transformed = await afterHook(req, res, currentData)
                    if (transformed !== undefined) {
                      currentData = transformed
                    }
                    if (res.headersSent) return
                  }
                  originalJson(currentData)
                }

                runAfterHooks().catch((err) => {
                  next(err)
                })
                return this
              }

              res.send = function (body: any) {
                if (handled) return originalSend(body)
                handled = true

                const runAfterHooks = async () => {
                  let currentData = body
                  for (const afterHook of afterHooks) {
                    const transformed = await afterHook(req, res, currentData)
                    if (transformed !== undefined) {
                      currentData = transformed
                    }
                    if (res.headersSent) return
                  }
                  originalSend(currentData)
                }

                runAfterHooks().catch((err) => {
                  next(err)
                })
                return this
              }

              next()
            }

            allMiddlewares.push(hookMiddleware)
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
          if (boundaryConfig.headers) {
            allHeaders = { ...allHeaders, ...boundaryConfig.headers }
          }
          if (boundaryConfig.plugins) {
            for (const plugin of boundaryConfig.plugins) {
              await app.pluginManager.register(plugin)
            }
          }
          if (boundaryConfig.imports) {
            for (const mod of boundaryConfig.imports) {
              const name = 'plugin' in mod ? mod.plugin.name : mod.name
              if (!app.pluginManager.hasPlugin(name)) {
                await app.pluginManager.register(mod)
              }
            }
          }
          if (boundaryConfig.providers) {
            for (const [token, providerConfig] of boundaryConfig.providers) {
              app.container.provide(token, providerConfig)
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  return {
    activeBoundaries,
    boundaryMiddlewares: allMiddlewares,
    boundaryFilters: allFilters,
    boundaryGuards: allGuards,
    boundaryInterceptors: allInterceptors,
    boundaryMetadata: allMetadata,
    boundaryCors: allCors,
    boundaryHeaders: allHeaders,
    hasBoundaries,
  }
}
