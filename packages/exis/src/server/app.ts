import {
  createServer as createHttpServer,
  IncomingMessage,
  ServerResponse,
} from 'node:http'
import type { Server as HttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { Server as HttpsServer } from 'node:https'
import { createSecureServer as createHttp2Server } from 'node:http2'
import type { Http2SecureServer } from 'node:http2'
import { WebSocketServer } from 'ws'
import type { Duplex } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { v } from '../utils/validator'

import { ExisRequest } from './request'
import { ExisResponse } from './response'
import { executionContext } from './context'
import { Router, runHandlers } from '../router/router'
import {
  cors,
  helmet,
  requestId,
  requestLogger,
  notFound,
  compression,
} from '../middleware/middleware'
import { createErrorHandler } from '../utils/errors'
import { ExisWebSocketServer } from '../websocket/server'
import { ExisWebSocket } from '../websocket/socket'
import { defaultConfig, mergeConfig } from '../utils/config'
import type { ResolvedConfig } from '../utils/config'
import { createLogger, resolveLoggerConfig } from '../utils/logger'
import { HotReloader } from './hot-reload'
import { formatDevError } from './dev-error-overlay'
import {
  isUwsAvailable,
  createUwsApp,
  UwsIncomingMessage,
  UwsServerResponse,
} from './uws-adapter'
import type { UwsListenToken } from './uws-adapter'
import { ExisQueue } from '../queue/client'
import { ExisWorker } from '../queue/worker'
import { CronScheduler } from '../cron/scheduler'
import type { JobOptions } from '../queue/types'
import { Container } from '../di/container'
import type { ProviderToken, ProviderDefinition } from '../di/container'

import type {
  Handler,
  ErrorHandler,
  ExisConfig,
  Request,
  Response,
  ListenOptions,
  Logger,
  ExisPlugin,
  ExisPluginInstance,
  HookReady,
  HookClose,
  HookRequest,
  HookResponse,
  HookError,
  HookRoute,
} from '../types'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class App<TRoutes extends Record<string, any> = {}> {
  private server!: HttpServer | HttpsServer | Http2SecureServer
  private redirectServer: HttpServer | null = null
  private router: Router
  public options: ResolvedConfig
  public apiDir: string | null = null
  private globalMiddleware: Handler[] = []
  private errorHandlers: ErrorHandler[] = []
  private _configured = false
  private _routesMounted = false
  private _loggerCreated = false
  private registeredPlugins = new Map<string, ExisPlugin<unknown>>()
  private routeMap = new Map<string, string>()
  private hotReloader: HotReloader | null = null
  private lazyRoutes = new Map<string, { filePath: string; loaded: boolean }>()

  private wsServer = new ExisWebSocketServer()
  private rawWsServer = new WebSocketServer({ noServer: true })

  public onStartHook?: (app: this) => void | Promise<void>
  public onCloseHook?: (app: this) => void | Promise<void>

  // ─── uWebSockets.js Backend ──────────────────────────────────────────────────
  private _useUws = false

  private _uwsApp: ReturnType<typeof createUwsApp> | null = null
  private _uwsListenToken: UwsListenToken | null = null

  // ─── Lifecycle Hooks Registry ───────────────────────────────────────────────
  private hooks = {
    ready: [] as HookReady[],
    close: [] as HookClose[],
    request: [] as HookRequest[],
    response: [] as HookResponse[],
    error: [] as HookError[],
    route: [] as HookRoute[],
  }

  // ─── Dataloaders Registry ───────────────────────────────────────────────────
  public _dataloaders = new Map<
    string,
    {
      batchFn: import('../dataloader/dataloader').BatchLoadFn<any, any>
      options?: import('../dataloader/dataloader').DataloaderOptions<any, any>
    }
  >()

  // ─── Public Logger ──────────────────────────────────────────────────────────
  public log!: Logger
  public explicitOptions: ExisConfig = {}

  // ─── Dependency Injection ───────────────────────────────────────────────────
  public container = new Container()

  // ─── Queue ──────────────────────────────────────────────────────────────────
  private _queueClient: ExisQueue | null = null
  private _queueWorker: ExisWorker | null = null
  private _cronScheduler: CronScheduler | null = null
  private _pendingQueueJobs: import('../queue/types').JobDefinition<unknown>[] =
    []

  public get queueClient() {
    return this._queueClient
  }
  public get queueWorker() {
    return this._queueWorker
  }

  constructor(options: ExisConfig = {}) {
    this.explicitOptions = options
    this.options = mergeConfig(defaultConfig, options)
    this.router = new Router()
    this.ensureLogger()

    // Queue setup is now deferred to app.create() when the config is loaded
    if (this.options.queue) {
      this._initQueue(this.options.queue)
    }

    // Auto-detect uWebSockets.js backend
    if (
      options.server === 'uws' ||
      (options.server !== 'node' &&
        isUwsAvailable() &&
        this.options.env !== 'test')
    ) {
      this._useUws = true
      // Don't init Node server — we'll create the uWS app at listen() time
    } else {
      this._useUws = false
      this.server = this._initServer()
    }
  }

  private ensureLogger() {
    if (this._loggerCreated) return
    this._loggerCreated = true
    const loggerOptions = resolveLoggerConfig(this.options.logger)
    if (process.env.__EXIS_REPL || process.env.__EXIS_TEST) {
      loggerOptions.level = 'warn'
    }
    this.log = createLogger(loggerOptions)
  }

  private _initServer(): HttpServer | HttpsServer | Http2SecureServer {
    let server: HttpServer | HttpsServer | Http2SecureServer

    if (this.options.ssl) {
      if (this.options.http2 !== false) {
        server = createHttp2Server(
          { allowHTTP1: true, ...this.options.ssl },
          this.handle.bind(this) as unknown as (
            req: unknown,
            res: unknown
          ) => void
        )
      } else {
        server = createHttpsServer(this.options.ssl, this.handle.bind(this))
      }
    } else {
      server = createHttpServer(this.handle.bind(this))
    }

    server.on('upgrade', this._handleUpgrade.bind(this))

    const keepAlive = this.options.keepAlive
    if (keepAlive) {
      const kaConfig = keepAlive === true ? {} : keepAlive
      if ('keepAliveTimeout' in server)
        server.keepAliveTimeout = kaConfig.timeoutMs ?? 5000
      if ('headersTimeout' in server)
        server.headersTimeout = kaConfig.headersTimeoutMs ?? 60000
      if (
        kaConfig.maxRequests !== undefined &&
        'maxRequestsPerSocket' in server
      ) {
        ;(
          server as unknown as { maxRequestsPerSocket: number }
        ).maxRequestsPerSocket = kaConfig.maxRequests
      }
    }

    return server
  }

  // ─── Lifecycle Hooks Registration ───────────────────────────────────────────
  onReady(cb: HookReady): this {
    this.hooks.ready.push(cb)
    return this
  }
  onClose(cb: HookClose): this {
    this.hooks.close.push(cb)
    return this
  }
  onRequest(cb: HookRequest): this {
    this.hooks.request.push(cb)
    return this
  }
  onResponse(cb: HookResponse): this {
    this.hooks.response.push(cb)
    return this
  }
  onError(cb: HookError): this {
    this.hooks.error.push(cb)
    return this
  }
  onRoute(cb: HookRoute): this {
    this.hooks.route.push(cb)
    return this
  }

  // ─── Dataloaders ────────────────────────────────────────────────────────────

  dataloader<K, V, C = K>(
    name: string,
    batchFn: import('../dataloader/dataloader').BatchLoadFn<K, V>,
    options?: import('../dataloader/dataloader').DataloaderOptions<K, C>
  ): this {
    if (this._dataloaders.has(name)) {
      throw new Error(`Dataloader '${name}' is already registered`)
    }
    this._dataloaders.set(name, { batchFn, options })
    return this
  }

  // ─── Introspection ──────────────────────────────────────────────────────────

  getRoutes(): import('../types').Route[] {
    return this.router.getRoutes()
  }

  // ─── Plugin System ──────────────────────────────────────────────────────────

  public hasPlugin(name: string): boolean {
    return this.registeredPlugins.has(name)
  }

  public async register<TOptions = Record<string, unknown>>(
    pluginOrInstance: ExisPlugin<TOptions> | ExisPluginInstance,
    legacyOptions?: TOptions
  ): Promise<this> {
    let plugin: ExisPlugin<TOptions>
    let options: TOptions | undefined

    if ('plugin' in pluginOrInstance && !('register' in pluginOrInstance)) {
      plugin = pluginOrInstance.plugin as ExisPlugin<TOptions>
      options = pluginOrInstance.options as TOptions
    } else {
      plugin = pluginOrInstance as ExisPlugin<TOptions>
      options = legacyOptions
    }

    if (this.registeredPlugins.has(plugin.name)) {
      throw new Error(`Plugin '${plugin.name}' is already registered`)
    }

    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.registeredPlugins.has(dep)) {
          throw new Error(
            `Plugin '${plugin.name}' requires dependency '${dep}' which is not registered`
          )
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let targetApp: App = this
    let pluginRouter: Router | undefined

    if (plugin.encapsulate !== false) {
      pluginRouter = new Router()
      // Create a proxy that intercepts route and middleware registrations
      targetApp = new Proxy(this, {
        get(target, prop, receiver) {
          if (
            [
              'get',
              'post',
              'put',
              'patch',
              'delete',
              'httpOptions',
              'head',
              'all',
              'ws',
              'query',
              'connect',
              'trace',
            ].includes(prop as string)
          ) {
            return (path: string, ...handlers: Handler[]) => {
              const routerMethod =
                prop === 'httpOptions' ? 'options' : (prop as string)
              ;(
                pluginRouter as unknown as Record<
                  string,
                  (...args: unknown[]) => unknown
                >
              )[routerMethod](path, ...handlers)
              return receiver
            }
          }
          if (prop === 'use') {
            return (...handlers: (Handler | ErrorHandler)[]) => {
              for (const h of handlers) {
                if (h.length === 4) {
                  // error handlers stay global for now, or we could scope them
                  target.use(h)
                } else {
                  pluginRouter!.use(h as Handler)
                }
              }
              return receiver
            }
          }

          // Encapsulate lifecycle hooks by converting them to scoped middleware!
          if (['onRequest', 'onResponse'].includes(prop as string)) {
            return (cb: any) => {
              if (prop === 'onRequest') {
                pluginRouter!.use(async (req: any, res: any, next: any) => {
                  try {
                    await cb(req, res)
                    next()
                  } catch (err) {
                    next(err)
                  }
                })
              } else if (prop === 'onResponse') {
                pluginRouter!.use((req: any, res: any, next: any) => {
                  res.raw.on('finish', () => {
                    cb(req, res).catch(() => {
                      /* ignore */
                    })
                  })
                  next()
                })
              }
              return receiver
            }
          }

          const value = Reflect.get(target, prop, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }

    await plugin.register(targetApp, options)

    if (pluginRouter) {
      this.mount('/', pluginRouter)
    }

    this.registeredPlugins.set(plugin.name, plugin as ExisPlugin<unknown>)
    return this
  }

  // ─── Middleware ─────────────────────────────────────────────────────────────

  use(...handlers: (Handler | ErrorHandler)[]): this {
    for (const h of handlers) {
      if (h.length === 4) {
        this.errorHandlers.push(h as ErrorHandler)
      } else {
        this.globalMiddleware.push(h as Handler)
      }
    }
    return this
  }

  get<
    Path extends string,
    Schema extends import('../types').RouteSchema<any, any, any, any>,
  >(
    path: Path,
    ...handlers:
      | [
          ...import('../types').Handler<any, any, any>[],
          Schema,
          import('../types').Handler<any, any, any>,
        ]
      | import('../types').RouteHandler<any, any, any, any>[]
  ): App<TRoutes & { get: Record<Path, Schema> }> {
    this.router.get(path, ...(handlers as any))
    this.hooks.route.forEach((hook) => hook({ method: 'GET', path }))
    return this as any
  }

  post<
    Path extends string,
    Schema extends import('../types').RouteSchema<any, any, any, any>,
  >(
    path: Path,
    ...handlers:
      | [
          ...import('../types').Handler<any, any, any>[],
          Schema,
          import('../types').Handler<any, any, any>,
        ]
      | import('../types').RouteHandler<any, any, any, any>[]
  ): App<TRoutes & { post: Record<Path, Schema> }> {
    this.router.post(path, ...(handlers as any))
    this.hooks.route.forEach((hook) => hook({ method: 'POST', path }))
    return this as any
  }

  put<
    Path extends string,
    Schema extends import('../types').RouteSchema<any, any, any, any>,
  >(
    path: Path,
    ...handlers:
      | [
          ...import('../types').Handler<any, any, any>[],
          Schema,
          import('../types').Handler<any, any, any>,
        ]
      | import('../types').RouteHandler<any, any, any, any>[]
  ): App<TRoutes & { put: Record<Path, Schema> }> {
    this.router.put(path, ...(handlers as any))
    this.hooks.route.forEach((hook) => hook({ method: 'PUT', path }))
    return this as any
  }

  patch<
    Path extends string,
    Schema extends import('../types').RouteSchema<any, any, any, any>,
  >(
    path: Path,
    ...handlers:
      | [
          ...import('../types').Handler<any, any, any>[],
          Schema,
          import('../types').Handler<any, any, any>,
        ]
      | import('../types').RouteHandler<any, any, any, any>[]
  ): App<TRoutes & { patch: Record<Path, Schema> }> {
    this.router.patch(path, ...(handlers as any))
    this.hooks.route.forEach((hook) => hook({ method: 'PATCH', path }))
    return this as any
  }

  delete<
    Path extends string,
    Schema extends import('../types').RouteSchema<any, any, any, any>,
  >(
    path: Path,
    ...handlers:
      | [
          ...import('../types').Handler<any, any, any>[],
          Schema,
          import('../types').Handler<any, any, any>,
        ]
      | import('../types').RouteHandler<any, any, any, any>[]
  ): App<TRoutes & { delete: Record<Path, Schema> }> {
    this.router.delete(path, ...(handlers as any))
    this.hooks.route.forEach((hook) => hook({ method: 'DELETE', path }))
    return this as any
  }

  httpOptions<
    Path extends string,
    Schema extends import('../types').RouteSchema<any, any, any, any>,
  >(
    path: Path,
    ...handlers:
      | [
          ...import('../types').Handler<any, any, any>[],
          Schema,
          import('../types').Handler<any, any, any>,
        ]
      | import('../types').RouteHandler<any, any, any, any>[]
  ): App<TRoutes & { options: Record<Path, Schema> }> {
    this.router.options(path, ...(handlers as any))
    this.hooks.route.forEach((hook) => hook({ method: 'OPTIONS', path }))
    return this as any
  }

  all<
    Path extends string,
    Schema extends import('../types').RouteSchema<any, any, any, any>,
  >(
    path: Path,
    ...handlers:
      | [
          ...import('../types').Handler<any, any, any>[],
          Schema,
          import('../types').Handler<any, any, any>,
        ]
      | import('../types').RouteHandler<any, any, any, any>[]
  ): App<TRoutes & { all: Record<Path, Schema> }> {
    this.router.all(path, ...(handlers as any))
    this.hooks.route.forEach((hook) => hook({ method: 'ALL', path }))
    return this as any
  }

  head<
    Path extends string,
    Schema extends import('../types').RouteSchema<any, any, any, any>,
  >(
    path: Path,
    ...handlers:
      | [
          ...import('../types').Handler<any, any, any>[],
          Schema,
          import('../types').Handler<any, any, any>,
        ]
      | import('../types').RouteHandler<any, any, any, any>[]
  ): App<TRoutes & { head: Record<Path, Schema> }> {
    this.router.head(path, ...(handlers as any))
    this.hooks.route.forEach((hook) => hook({ method: 'HEAD', path }))
    return this as any
  }

  connect<
    Path extends string,
    Schema extends import('../types').RouteSchema<any, any, any, any>,
  >(
    path: Path,
    ...handlers:
      | [
          ...import('../types').Handler<any, any, any>[],
          Schema,
          import('../types').Handler<any, any, any>,
        ]
      | import('../types').RouteHandler<any, any, any, any>[]
  ): App<TRoutes & { connect: Record<Path, Schema> }> {
    this.router.connect(path, ...(handlers as any))
    this.hooks.route.forEach((hook) => hook({ method: 'CONNECT', path }))
    return this as any
  }

  trace<
    Path extends string,
    Schema extends import('../types').RouteSchema<any, any, any, any>,
  >(
    path: Path,
    ...handlers:
      | [
          ...import('../types').Handler<any, any, any>[],
          Schema,
          import('../types').Handler<any, any, any>,
        ]
      | import('../types').RouteHandler<any, any, any, any>[]
  ): App<TRoutes & { trace: Record<Path, Schema> }> {
    this.router.trace(path, ...(handlers as any))
    this.hooks.route.forEach((hook) => hook({ method: 'TRACE', path }))
    return this as any
  }

  query<
    Path extends string,
    Schema extends import('../types').RouteSchema<any, any, any, any>,
  >(
    path: Path,
    ...handlers:
      | [
          ...import('../types').Handler<any, any, any>[],
          Schema,
          import('../types').Handler<any, any, any>,
        ]
      | import('../types').RouteHandler<any, any, any, any>[]
  ): App<TRoutes & { query: Record<Path, Schema> }> {
    this.router.query(path, ...(handlers as any))
    this.hooks.route.forEach((hook) => hook({ method: 'QUERY', path }))
    return this as any
  }

  // ─── WebSocket Registration ──────────────────────────────────────────────────

  ws<Path extends string>(
    path: Path,
    ...handlers: (
      import('../types').Handler<any, any, any> | import('../types').WsHandler
    )[]
  ): App<TRoutes & { ws: Record<Path, any> }> {
    this.router.ws(path, ...(handlers as any))
    this.hooks.route.forEach((hook) => hook({ method: 'WS', path }))
    return this as any
  }

  publish(room: string, data: unknown): void {
    this.wsServer.publish(room, data)
  }

  // ─── Mount Sub-Router ─────────────────────────────────────────────────────────

  mount(prefix: string, subRouter: Router): this {
    // copy routes from sub-router with prefix prepended
    for (const route of subRouter.getRoutes()) {
      const newRouter = new Router()
      const method = route.method.toLowerCase() as Lowercase<
        import('../types').HttpMethod
      >
      if (method === 'all') {
        newRouter.all(prefix + route.path, ...(route.handlers as any[]))
      } else {
        ;(newRouter as any)[method](
          prefix + route.path,
          ...(route.handlers as any[])
        )
      }
      for (const r of newRouter.getRoutes()) {
        this.router.addRawRoute(r)
      }
      this.hooks.route.forEach((hook) =>
        hook({ method: route.method, path: prefix + route.path })
      )
    }
    return this
  }

  // ─── Class-Based Controllers Registration ──────────────────────────────────

  public registerControllers(
    controllers: any[],
    basePath = '',
    prefixMiddlewares: any[] = []
  ): this {
    const ROUTE_REGISTRY = Symbol.for('exisjs:routes')
    const CONTROLLER_PREFIX = Symbol.for('exisjs:controller_prefix')
    const CONTROLLER_HOST = Symbol.for('exisjs:controller_host')
    const MIDDLEWARE_REGISTRY = Symbol.for('exisjs:middlewares')
    const ROUTE_METADATA = Symbol.for('exisjs:route_metadata')
    const LIFECYCLE_METADATA = Symbol.for('exisjs:lifecycle_metadata')
    const PARAM_METADATA = Symbol.for('exisjs:param_metadata')

    for (const ControllerClass of controllers) {
      const prefix = ControllerClass.prototype[CONTROLLER_PREFIX] || ''
      const host = ControllerClass.prototype[CONTROLLER_HOST]
      const routes = ControllerClass.prototype[ROUTE_REGISTRY] || []
      const classMiddlewares = [
        ...(Array.isArray(ControllerClass.prototype[MIDDLEWARE_REGISTRY])
          ? ControllerClass.prototype[MIDDLEWARE_REGISTRY]
          : ControllerClass.prototype[MIDDLEWARE_REGISTRY]?._classMiddlewares ||
            []),
      ]
      const methodMiddlewares =
        (!Array.isArray(ControllerClass.prototype[MIDDLEWARE_REGISTRY])
          ? ControllerClass.prototype[MIDDLEWARE_REGISTRY]
          : {}) || {}

      const routeMetadataMap = ControllerClass.prototype[ROUTE_METADATA] || {}
      const lifecycleMetadataMap =
        ControllerClass.prototype[LIFECYCLE_METADATA] || {}
      const paramMetadataMap = ControllerClass.prototype[PARAM_METADATA] || {}

      for (const route of routes) {
        const method = route.method.toLowerCase() as any

        const executeCore = async (
          req: import('../types').Request,
          res: import('../types').Response,
          next: import('../types').NextFunction,
          streamOrSocket?: any
        ) => {
          let instance: any = this.container.resolve(ControllerClass)
          if (!instance) {
            // Auto-instantiate if not provided via DI
            instance = new ControllerClass()
            this.container.provide(ControllerClass, { useValue: instance })
          }
          try {
            // 1. Run Guards
            const routeLifecycle = lifecycleMetadataMap[route.handlerName] || {}
            const guards = routeLifecycle.guards || []
            for (const guard of guards) {
              let allowed = false
              if (typeof guard === 'function') {
                if (
                  guard.prototype &&
                  typeof guard.prototype.canActivate === 'function'
                ) {
                  let guardInstance: any = this.container.resolve(guard)
                  if (!guardInstance) {
                    guardInstance = new (guard as any)()
                  }
                  allowed = await guardInstance.canActivate(req)
                } else {
                  allowed = await guard(req)
                }
              }
              if (!allowed) {
                if (res) {
                  res.status(403).json({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Forbidden by Guard' },
                  })
                }
                return
              }
            }

            // 2. Resolve parameters
            const paramMetadata = paramMetadataMap[route.handlerName] || []
            const args: any[] = []

            if (paramMetadata.length === 0) {
              if (method === 'ws' || method === 'sse') {
                args.push(req, streamOrSocket)
              } else {
                args.push(req, res, next)
              }
            } else {
              for (const param of paramMetadata) {
                if (!param) {
                  args.push(undefined)
                  continue
                }
                let rawArg: any
                switch (param.type) {
                  case 'req':
                    rawArg = req
                    break
                  case 'res':
                    rawArg = res
                    break
                  case 'body':
                    if (
                      req.body === undefined &&
                      ['POST', 'PUT', 'PATCH'].includes(req.method!)
                    ) {
                      const contentType = req.headers['content-type'] || ''
                      if (contentType.includes('json')) {
                        await req.json().catch(() => {
                          /* noop */
                        })
                      } else if (contentType.includes('form')) {
                        await req.formData().catch(() => {
                          /* noop */
                        })
                      }
                    }
                    rawArg = req.body
                    break
                  case 'param':
                    rawArg = param.name ? req.params[param.name] : req.params
                    break
                  case 'query':
                    rawArg = param.name ? req.query[param.name] : req.query
                    break
                  case 'header':
                    rawArg = param.name
                      ? req.headers[param.name.toLowerCase()]
                      : req.headers
                    break
                  case 'session':
                    rawArg = (req as any).session
                    break
                  case 'next':
                    rawArg = next
                    break
                  case 'host':
                    rawArg = param.name
                      ? (req.params as any)[param.name]
                      : req.hostname
                    break
                  case 'socket':
                  case 'stream':
                    rawArg = streamOrSocket
                    break
                  case 'ip':
                    rawArg = req.ip
                    break
                  case 'uploadedFile':
                  case 'uploadedFiles':
                    if (
                      req.body === undefined &&
                      ['POST', 'PUT', 'PATCH'].includes(req.method!)
                    ) {
                      await req.formData().catch(() => {
                        /* noop */
                      })
                    }
                    if (req.files) {
                      const isMulti = param.type === 'uploadedFiles'
                      let files: any[] = []
                      if (param.name) {
                        files = req.files.filter(
                          (f: any) => f.fieldname === param.name
                        )
                      } else {
                        files = req.files
                      }
                      rawArg = isMulti ? files : files[0]
                    }
                    break
                  default:
                    rawArg = undefined
                }

                if (param.pipes && param.pipes.length > 0) {
                  for (const pipe of param.pipes) {
                    if (
                      typeof pipe === 'function' &&
                      pipe.prototype?.transform
                    ) {
                      let pipeInstance: any = this.container.resolve(pipe)
                      if (!pipeInstance) pipeInstance = new pipe()
                      rawArg = await pipeInstance.transform(rawArg, {
                        type: param.type,
                        name: param.name,
                      })
                    } else if (
                      typeof pipe === 'object' &&
                      typeof pipe.parse === 'function'
                    ) {
                      rawArg = await pipe.parse(rawArg)
                    } else if (
                      typeof pipe === 'object' &&
                      typeof pipe.transform === 'function'
                    ) {
                      rawArg = await pipe.transform(rawArg, {
                        type: param.type,
                        name: param.name,
                      })
                    } else if (typeof pipe === 'function') {
                      rawArg = await pipe(rawArg)
                    }
                  }
                }

                args.push(rawArg)
              }
            }

            // 3. Execute Custom Interceptors
            const interceptors = routeLifecycle.interceptors || []
            for (const interceptor of interceptors) {
              if (typeof interceptor === 'function') {
                if (
                  interceptor.prototype &&
                  typeof interceptor.prototype.intercept === 'function'
                ) {
                  let interceptorInstance: any =
                    this.container.resolve(interceptor)
                  if (!interceptorInstance) {
                    interceptorInstance = new (interceptor as any)()
                  }
                  await interceptorInstance.intercept(req, res)
                } else {
                  await interceptor(req, res)
                }
              }
            }

            // 4. Invoke the method
            const result = await instance[route.handlerName](...args)

            if (res && !res.headersSent) {
              const routeMeta = routeMetadataMap[route.handlerName] || {}

              if (routeMeta.redirect) {
                res.redirect(
                  routeMeta.redirect.url,
                  routeMeta.redirect.statusCode
                )
                return
              }

              // Apply custom headers
              if (routeMeta.headers) {
                for (const [name, val] of Object.entries(routeMeta.headers)) {
                  res.setHeader(name, val as string)
                }
              }
              // Apply custom HTTP Code
              if (routeMeta.httpCode) {
                res.status(routeMeta.httpCode)
              }

              if (result !== undefined) {
                res.json(result)
              }
            }
          } catch (err) {
            let handled = false
            const routeLifecycle = lifecycleMetadataMap[route.handlerName] || {}
            const filters = routeLifecycle.filters || []
            for (const filter of filters) {
              if (typeof filter === 'function' && filter.prototype?.catch) {
                let filterInstance: any = this.container.resolve(filter)
                if (!filterInstance) filterInstance = new filter()
                await filterInstance.catch(err, { req, res })
                handled = true
                break
              } else if (
                typeof filter === 'object' &&
                typeof filter.catch === 'function'
              ) {
                await filter.catch(err, { req, res })
                handled = true
                break
              }
            }
            if (!handled) {
              if (next) next(err as Error)
              else console.error(`[Exis ${method.toUpperCase()} Error]`, err)
            }
          }
        }

        let finalHandler: any
        if (method === 'ws' || method === 'sse') {
          finalHandler = async (streamOrSocket: any, rawReq: any) => {
            await executeCore(
              rawReq,
              undefined as any,
              undefined as any,
              streamOrSocket
            )
          }
        } else {
          finalHandler = async (
            req: import('../types').Request,
            res: import('../types').Response,
            next: import('../types').NextFunction
          ) => {
            await executeCore(req, res, next)
          }
        }

        const fullPath =
          (basePath + prefix + route.path).replace(/\/+/g, '/') || '/'

        const routeSpecificMiddlewares =
          methodMiddlewares[route.handlerName] || []
        const allMiddlewares = [
          ...prefixMiddlewares,
          ...classMiddlewares,
          ...routeSpecificMiddlewares,
        ]

        const routeMeta = routeMetadataMap[route.handlerName] || {}
        const finalHost = routeMeta.hosts || host

        let schema = route.schema
        const paramMetadata = paramMetadataMap[route.handlerName] || []

        let extractedBodySchema: any = undefined
        let extractedQuerySchema: any = undefined

        for (const param of paramMetadata) {
          if (!param) continue
          if (param.type === 'body') {
            const bodyPipe = param.pipes?.find(
              (p: any) => p && typeof p.parse === 'function'
            )
            if (bodyPipe) extractedBodySchema = bodyPipe
          }
          if (param.type === 'query') {
            const queryPipe = param.pipes?.find(
              (p: any) => p && typeof p.parse === 'function'
            )
            if (queryPipe) extractedQuerySchema = queryPipe
          }
        }

        const extractedResponseSchema = routeMeta.responseSchema

        if (
          schema ||
          finalHost ||
          extractedBodySchema ||
          extractedQuerySchema ||
          extractedResponseSchema
        ) {
          schema = schema || {}
          if (finalHost) schema.host = finalHost
          if (extractedBodySchema && !schema.body)
            schema.body = extractedBodySchema
          if (extractedQuerySchema && !schema.query)
            schema.query = extractedQuerySchema
          if (extractedResponseSchema && !schema.response)
            schema.response = extractedResponseSchema

          ;(this.router as any)[method](
            fullPath,
            ...allMiddlewares,
            schema,
            finalHandler
          )
        } else {
          ;(this.router as any)[method](
            fullPath,
            ...allMiddlewares,
            finalHandler
          )
        }
      }
    }
    return this
  }

  // ─── Dependency Injection ───────────────────────────────────────────────────

  provide<T>(token: ProviderToken<T>, provider: ProviderDefinition<T>): this {
    this.container.provide(token, provider)
    return this
  }

  resolve<T>(token: ProviderToken<T>, requestCache?: Map<any, any>): T {
    return this.container.resolve(token, requestCache)
  }

  // ─── Built-in Feature Toggles ─────────────────────────────────────────────────

  private applyBuiltins(): void {
    if (this._configured) return
    this._configured = true
    this.ensureLogger()

    const {
      cors: corsOpt,
      helmet: helmetOpt,
      logger: logOpt,
      compression: compressionOpt,
    } = this.options

    // Request ID always on
    this.globalMiddleware.unshift(requestId())

    if (logOpt !== false) {
      this.globalMiddleware.push(requestLogger(this.log))
    }

    if (compressionOpt) {
      this.globalMiddleware.push(compression())
    }

    if (helmetOpt !== false) {
      this.globalMiddleware.push(helmet())
    }

    if (corsOpt !== false) {
      this.globalMiddleware.push(cors(corsOpt === true ? {} : corsOpt))
    }

    if (this.options.plugins) {
      for (const plugin of this.options.plugins) {
        if (!this.hasPlugin(plugin.name)) {
          // We can't await inside sync constructor easily, but plugins are usually sync in register.
          // For async plugins in config, they should be loaded before app starts.
          // App.register is async, so we'll push the promise and warn if it's not awaited
          this.register(plugin).catch((err) =>
            console.error(
              `[Exis] Failed to register plugin ${plugin.name} from config:`,
              err
            )
          )
        }
      }
    }

    // rate limiting removed from core

    // default error handler
    if (this.errorHandlers.length === 0) {
      this.errorHandlers.push(
        createErrorHandler(this.options.env === 'development')
      )
    }
  }

  private _compiledPipeline?: Handler[]

  private getCompiledPipeline(): Handler[] {
    if (this._compiledPipeline) return this._compiledPipeline
    this.applyBuiltins()
    this._compiledPipeline = [
      ...this.globalMiddleware,
      (req, res, next) => this.router.handle(req, res, next),
      notFound,
    ]
    return this._compiledPipeline
  }

  // ─── Web Standard Fetch (Edge Runtime) & Inject ──────────────────────────────

  public async fetch(
    request: globalThis.Request,
    env?: any,
    ctx?: any
  ): Promise<globalThis.Response> {
    const { handleFetch } = await import('../adapters/fetch')
    return handleFetch(this, request, env, ctx)
  }

  public async inject(options: {
    method?: string
    url: string
    headers?: Record<string, string>
    body?: any
  }): Promise<import('../testing/client').TestResponse> {
    const method = (options.method || 'GET').toUpperCase()
    const url = options.url.startsWith('http')
      ? options.url
      : `http://localhost${options.url}`

    const headers = new Headers()
    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        headers.set(k, v)
      }
    }

    let bodyStr: string | undefined
    if (options.body) {
      bodyStr =
        typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body)
      if (!headers.has('content-type') && typeof options.body !== 'string') {
        headers.set('content-type', 'application/json')
      }
    }

    const req = new Request(url, {
      method,
      headers,
      body: ['GET', 'HEAD', 'OPTIONS'].includes(method) ? undefined : bodyStr,
    })

    const fetchRes = await this.fetch(req)
    const resText = await fetchRes.text()

    let parsedBody: any = resText
    try {
      parsedBody = JSON.parse(resText)
    } catch {
      // ignore
    }

    const resHeaders: Record<string, string> = {}
    fetchRes.headers.forEach((v, k) => {
      resHeaders[k] = v
    })

    return {
      status: fetchRes.status,
      headers: resHeaders,
      body: parsedBody,
      text: resText,
    }
  }

  // ─── Private Internal Pipeline Handler ─────────────────────────────────────────────────────

  public _executeWithContext(
    req: ExisRequest,
    res: ExisResponse,
    execution: () => void
  ): void {
    const store: import('./context').InternalContext = {
      state: {},
      afterCallbacks: [],
      req: req as unknown as import('../types').Request,
      res: res as unknown as import('../types').Response,
      app: this,
      diCache: new Map(),
    }

    res.raw.on('finish', () => {
      for (const cb of store.afterCallbacks) {
        try {
          const promise = cb()
          if (promise instanceof Promise) {
            promise.catch((err) => {
              this.log.error({ err }, 'Error in after() background task')
            })
          }
        } catch (err) {
          this.log.error({ err }, 'Error in after() background task')
        }
      }
    })

    executionContext.run(store, execution)
  }

  public handle(rawReq: IncomingMessage, rawRes: ServerResponse): void {
    const res = new ExisResponse(rawRes)
    const req = new ExisRequest(
      rawReq,
      res,
      this.options.trustProxy,
      this.options.bodyLimit
    )
    res.req = req
    res.etagEnabled = this.options.etag === true
    req.log = this.log
    req._dataloaderFns = this._dataloaders

    this._executeWithContext(req, res, () => {
      if (this.hooks.request.length === 0 && this.hooks.response.length === 0) {
        runHandlers(this.getCompiledPipeline(), req, res, (err) => {
          if (err) {
            this._runErrorHandlers(err, req, res).catch((e) => {
              this.log.error({ err: e }, 'Error in error handler')
            })
          }
        })
        return
      }

      this._handleWithHooks(req, res, rawRes)
    })
  }

  /**
   * Handle a request from the uWebSockets.js backend.
   * Uses the same middleware pipeline as Node HTTP but with uWS shims.
   */
  public handleUws(
    shimReq: UwsIncomingMessage,
    shimRes: UwsServerResponse
  ): void {
    // Wrap uWS shims in ExisRequest/ExisResponse using type coercion
    // The shims implement the same interface that ExisRequest/ExisResponse expect
    const res = new ExisResponse(shimRes as unknown as ServerResponse)
    const req = new ExisRequest(
      shimReq as unknown as IncomingMessage,
      res,
      this.options.trustProxy,
      this.options.bodyLimit
    )
    res.req = req
    res.etagEnabled = this.options.etag === true
    req.log = this.log
    req._dataloaderFns = this._dataloaders

    this._executeWithContext(req, res, () => {
      if (this.hooks.request.length === 0 && this.hooks.response.length === 0) {
        runHandlers(this.getCompiledPipeline(), req, res, (err) => {
          if (err) {
            this._runErrorHandlers(err, req, res).catch((e) => {
              this.log.error({ err: e }, 'Error in error handler')
            })
          }
        })
        return
      }

      this._handleWithHooks(req, res, shimRes as unknown as ServerResponse)
    })
  }

  private async _handleWithHooks(
    req: ExisRequest,
    res: ExisResponse,
    rawRes: ServerResponse
  ): Promise<void> {
    // ─── onRequest Hook ───
    if (this.hooks.request.length > 0) {
      // eslint-disable-next-line @typescript-eslint/prefer-for-of
      for (let i = 0; i < this.hooks.request.length; i++) {
        await this.hooks.request[i](
          req as unknown as Request,
          res as unknown as Response
        )
      }
    }
    if (res.headersSent) return

    // ─── onResponse Hook ───
    if (this.hooks.response.length > 0) {
      rawRes.on('finish', () => {
        // eslint-disable-next-line @typescript-eslint/prefer-for-of
        for (let i = 0; i < this.hooks.response.length; i++) {
          Promise.resolve(
            this.hooks.response[i](
              req as unknown as Request,
              res as unknown as Response
            )
          ).catch((err) => {
            this.log.error({ err }, 'Error in onResponse hook')
          })
        }
      })
    }

    runHandlers(
      this.getCompiledPipeline(),
      req as unknown as Request,
      res as unknown as Response,
      (err) => {
        if (err) {
          this._runErrorHandlers(
            err,
            req as unknown as Request,
            res as unknown as Response
          ).catch((e) => {
            this.log.error({ err: e }, 'Error in error handler')
          })
        }
      }
    )
  }

  private async _runErrorHandlers(
    err: Error,
    req: Request,
    res: Response
  ): Promise<void> {
    // ─── onError Hook ───
    if (this.hooks.error.length > 0) {
      // eslint-disable-next-line @typescript-eslint/prefer-for-of
      for (let i = 0; i < this.hooks.error.length; i++) {
        await this.hooks.error[i](err, req, res)
      }
    }

    if (res.headersSent) return

    for (const handler of this.errorHandlers) {
      let handled = false
      await handler(err, req, res, () => {
        handled = true
      })
      if (!handled || res.headersSent) return
    }

    // fallback if no error handler ran
    const defaultHandler = createErrorHandler(
      this.options.env === 'development'
    )
    await defaultHandler(err, req, res, () => {
      /* noop */
    })
  }

  // ─── WebSocket Upgrade Handler ───────────────────────────────────────────────

  private async _handleUpgrade(
    rawReq: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): Promise<void> {
    this.applyBuiltins()

    // Match route
    const reqPath = (rawReq.url || '').split('?')[0]
    const matched = this.router.match('WS', reqPath)
    if (!matched) {
      socket.write('HTTP/1.1 404 Not Found\\r\\n\\r\\n')
      socket.destroy()
      return
    }

    // Create a dummy ServerResponse so standard HTTP middleware can run and reject if needed
    const rawRes = new ServerResponse(rawReq)
    rawRes.assignSocket(socket as unknown as import('node:net').Socket)
    const res = new ExisResponse(rawRes)
    const originalMethod = rawReq.method
    const req = new ExisRequest(
      rawReq,
      res,
      this.options.trustProxy,
      this.options.bodyLimit
    )
    res.req = req
    req.method = 'WS'
    req.params = matched.params
    req.log = this.log

    // Build the middleware pipeline specifically for this WebSocket route
    const pipeline: Handler[] = [
      ...this.globalMiddleware,
      async (req, res, next) => {
        // Exclude the last handler which is the actual WsHandler wrapper
        const routeHandlers = matched.route.handlers.slice(0, -1)
        runHandlers(routeHandlers, req, res, (err) => {
          if (err) return next(err)
          next()
        })
      },
    ]

    await runHandlers(pipeline, req, res, async (err) => {
      if (err) {
        this.log.error({ err }, 'Error during WebSocket upgrade middleware')
        socket.write('HTTP/1.1 500 Internal Server Error\\r\\n\\r\\n')
        socket.destroy()
        return
      }

      if (res.headersSent) {
        // A middleware intercepted and sent an HTTP response (e.g. 401 Unauthorized)
        socket.destroy()
        return
      }

      // Restore original HTTP method (usually 'GET') so the `ws` package doesn't reject with 405
      rawReq.method = originalMethod

      // Middleware passed, perform upgrade
      this.rawWsServer.handleUpgrade(rawReq, socket, head, (ws) => {
        const exisWs = new ExisWebSocket(ws, req, this.wsServer)
        this.wsServer.track(exisWs)
        // Attach to request so the wrapped ws() handler in Router can extract it
        ;(req as Request & { ws?: ExisWebSocket }).ws = exisWs

        const finalHandler =
          matched.route.handlers[matched.route.handlers.length - 1]
        Promise.resolve(
          finalHandler(req, res, () => {
            /* noop */
          })
        ).catch((err) => {
          this.log.error({ err }, 'Error in WebSocket handler')
          ws.close(1011, 'Internal Server Error')
        })
      })
    })
  }

  /**
   * WebSocket Upgrade Handler for uWebSockets.js
   * Runs the middleware pipeline and if successful, upgrades the connection.
   */

  public async handleUwsUpgrade(
    shimReq: UwsIncomingMessage,
    uwsRes: any,
    context: any
  ): Promise<void> {
    this.applyBuiltins()

    const reqPath = (shimReq.url || '').split('?')[0]
    const matched = this.router.match('WS', reqPath)

    if (!matched) {
      // 404
      uwsRes.cork(() => {
        uwsRes.writeStatus('404 Not Found')
        uwsRes.end()
      })
      return
    }

    let isAborted = false
    uwsRes.onAborted(() => {
      isAborted = true
    })

    const shimRes = new UwsServerResponse(uwsRes)
    const res = new ExisResponse(shimRes as unknown as ServerResponse)
    const req = new ExisRequest(
      shimReq as unknown as IncomingMessage,
      res,
      this.options.trustProxy,
      this.options.bodyLimit
    )
    res.req = req
    req.method = 'WS'
    req.params = matched.params
    req.log = this.log

    const pipeline: Handler[] = [
      ...this.globalMiddleware,
      async (req, res, next) => {
        const routeHandlers = matched.route.handlers.slice(0, -1)
        runHandlers(routeHandlers, req, res, (err) => {
          if (err) return next(err)
          next()
        })
      },
    ]

    this._executeWithContext(req, res, () => {
      runHandlers(pipeline, req, res, async (err) => {
        if (isAborted) return

        if (err) {
          this.log.error(
            { err },
            'Error during uWS WebSocket upgrade middleware'
          )
          uwsRes.cork(() => {
            uwsRes.writeStatus('500 Internal Server Error')
            uwsRes.end()
          })
          return
        }

        if (res.headersSent) {
          return // Middleware sent an HTTP response
        }

        // We need to fetch headers directly from the shimReq.headers
        const secWebSocketKey = shimReq.headers['sec-websocket-key'] || ''
        const secWebSocketProtocol =
          shimReq.headers['sec-websocket-protocol'] || ''
        const secWebSocketExtensions =
          shimReq.headers['sec-websocket-extensions'] || ''

        // Prepare user data for the upgraded websocket
        const userData = {
          req,
          res,
          exisWs: new ExisWebSocket(null as any, req, this.wsServer), // the raw will be set to shim in open()
          finalHandler:
            matched.route.handlers[matched.route.handlers.length - 1],
        }

        this.wsServer.track(userData.exisWs)
        // Attach to request
        ;(req as Request & { ws?: ExisWebSocket }).ws = userData.exisWs

        uwsRes.cork(() => {
          uwsRes.upgrade(
            userData,
            secWebSocketKey,
            secWebSocketProtocol,
            secWebSocketExtensions,
            context
          )
        })

        Promise.resolve(
          userData.finalHandler(req, res, () => {
            /* noop */
          })
        ).catch((e) => {
          this.log.error({ err: e }, 'Error in uWS WebSocket handler')
        })
      })
    })
  }

  private shutdownHooks: (() => Promise<void> | void)[] = []

  // ─── Listen ───────────────────────────────────────────────────────────────────

  listen(
    portOrOptions?: number | ListenOptions,
    callback?: () => void
  ): HttpServer | HttpsServer | Http2SecureServer {
    if (process.env.EXIS_CLI_MODE === '1') {
      return undefined as unknown as HttpServer
    }
    this.applyBuiltins()

    let port: number
    let host: string
    let onListen:
      ((address: { port: number; host: string }) => void) | undefined

    if (typeof portOrOptions === 'number') {
      port = portOrOptions
      host = this.options.host
      onListen = callback ? () => callback() : undefined
    } else if (typeof portOrOptions === 'object') {
      if (portOrOptions.ssl) {
        this.options.ssl = portOrOptions.ssl
        // Re-initialize server if ssl is passed during listen
        this.server = this._initServer()
      }
      if (portOrOptions.redirectHttp !== undefined) {
        this.options.redirectHttp = portOrOptions.redirectHttp
      }
      port = portOrOptions.port ?? this.options.port
      host = portOrOptions.host ?? this.options.host
      onListen = portOrOptions.onListen
    } else {
      port = this.options.port
      host = this.options.host
    }

    // Auto HTTP -> HTTPS redirect server (only for Node HTTP backend)

    // ─── uWebSockets.js listen path ───
    if (this._useUws) {
      this._uwsApp = createUwsApp(
        this.handleUws.bind(this),
        this.handleUwsUpgrade.bind(this),
        this.options.ssl
      )

      this._uwsApp.listen(port, host, async (token) => {
        if (!token) {
          this.log.error(`Failed to listen on ${host}:${port} (uWS)`)
          return
        }
        this._uwsListenToken = token
        const address = { port, host }

        if (this.hotReloader) {
          this.hotReloader.stop()
        }

        if (onListen) {
          onListen(address)
        } else {
          if (!process.env.__EXIS_DEV_SERVER && !process.env.__EXIS_CLI) {
            const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`
            this.log.info(
              { url, env: this.options.env, backend: 'uws' },
              `Server running at ${url} (uWebSockets.js)`
            )
          }
        }

        if (this.options.env === 'production') {
          const handleShutdown = async () => {
            this.log.info('Received shutdown signal (SIGTERM/SIGINT)')
            try {
              await this.close()
              process.exit(0)
            } catch (err) {
              this.log.error({ err }, 'Error during graceful shutdown')
              process.exit(1)
            }
          }
          process.once('SIGTERM', handleShutdown)
          process.once('SIGINT', handleShutdown)
        }

        // ─── onReady Hook ───
        for (const hook of this.hooks.ready) {
          await hook()
        }

        if (callback) callback()
      })

      // Return a minimal server-like object for compatibility
      return this.server
    }

    // ─── Node HTTP listen path ───

    // Auto HTTP -> HTTPS redirect server
    if (
      this.options.ssl &&
      this.options.redirectHttp !== undefined &&
      this.options.redirectHttp !== false
    ) {
      const redirectPort =
        typeof this.options.redirectHttp === 'number'
          ? this.options.redirectHttp
          : 80
      this.redirectServer = createHttpServer((req, res) => {
        const targetHost = req.headers.host?.split(':')[0] || host
        const actualPort =
          port === 0
            ? (this.server.address() as import('node:net').AddressInfo)?.port ||
              port
            : port
        const targetPort = actualPort === 443 ? '' : `:${actualPort}`
        res.writeHead(301, {
          Location: `https://${targetHost}${targetPort}${req.url || '/'}`,
        })
        res.end()
      })
      this.redirectServer.listen(redirectPort, host, () => {
        this.log.info(
          `Redirect server listening on port ${redirectPort} -> HTTPS port ${port}`
        )
      })
    }

    this.server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n\x1b[31m✗ Port ${port} is already in use.\x1b[0m`)
        console.error(
          `  Try killing the process or use a different port in exis.config.ts\n`
        )
        process.exit(1)
      } else {
        this.log.error({ err }, 'Failed to start server')
        process.exit(1)
      }
    })

    this.server.listen(port, host, async () => {
      const address = { port, host }

      if (this.options.env === 'production') {
        const handleShutdown = async () => {
          this.log.info('Received shutdown signal (SIGTERM/SIGINT)')
          try {
            await this.close()
            process.exit(0)
          } catch (err) {
            this.log.error({ err }, 'Error during graceful shutdown')
            process.exit(1)
          }
        }
        process.once('SIGTERM', handleShutdown)
        process.once('SIGINT', handleShutdown)
      }

      // ─── onReady Hook ───
      for (const hook of this.hooks.ready) {
        await hook()
      }

      // Start queue worker if initialized
      if (this._queueWorker) {
        await this._queueWorker.start()
      }

      if (onListen) {
        onListen(address)
      } else {
        if (!process.env.__EXIS_DEV_SERVER && !process.env.__EXIS_CLI) {
          const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`
          this.log.info(
            { url, env: this.options.env },
            `Server running at ${url}`
          )
        }
      }

      if (callback) callback()
    })

    return this.server
  }

  // ─── Banner ───────────────────────────────────────────────────────────────────
  public async _printStartupBanner(): Promise<void> {
    const port = this.options.port ?? 3000
    const host = this.options.host ?? 'localhost'
    const c = {
      cyan: '\x1b[36m',
      green: '\x1b[32m',
      gray: '\x1b[90m',
      dim: '\x1b[2m',
      bold: '\x1b[1m',
      reset: '\x1b[0m',
      magenta: '\x1b[35m',
      bgMagenta: '\x1b[45m',
      white: '\x1b[37m',
      primary: '\x1b[38;2;160;70;255m',
      blue: '\x1b[38;2;41;169;206m',
    }

    let fwVersion = '0.0.0'
    try {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const pkgPath = path.join(__dirname, '../../package.json')
      fwVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version
    } catch {
      /* ignore */
    }

    const displayHost =
      host === '0.0.0.0' || host === '127.0.0.1' ? 'localhost' : host

    let localIp = '<YOUR_IP>'
    try {
      const os = await import('node:os')
      const nets = os.networkInterfaces()
      for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
          if (net.family === 'IPv4' && !net.internal) {
            localIp = net.address
            break
          }
        }
        if (localIp !== '<YOUR_IP>') break
      }
    } catch {
      /* ignore */
    }

    const networkHost =
      host === '0.0.0.0'
        ? `http://${localIp}:${port}`
        : 'use --host 0.0.0.0 to expose'

    const readyMs = 125
    const displayEnv = this.options.env || process.env.NODE_ENV || 'development'
    const workerCount = process.env.__EXIS_CLUSTER_WORKERS

    const cluster = await import('node:cluster')
    // In cluster mode, ONLY let Worker #1 print the banner so we don't spam the console 12 times
    if (cluster.default.isWorker && cluster.default.worker?.id !== 1) {
      return
    }

    console.log(
      `\n  ${c.primary}${c.bold}EXIS v${fwVersion}${c.reset}  ready in ${c.bold}${readyMs} ms${c.reset}\n`
    )
    console.log(
      `  ${c.white}➜${c.reset}  ${c.bold}Local:${c.reset}   ${c.blue}http://${displayHost}:${port}/${c.reset}`
    )
    console.log(
      `  ${c.white}➜${c.reset}  ${c.dim}Network:${c.reset} ${c.blue}${networkHost}/${c.reset}`
    )
    console.log(
      `  ${c.white}➜${c.reset}  ${c.dim}Environ:${c.reset} ${c.green}${displayEnv}${c.reset}`
    )
    if (workerCount && Number(workerCount) > 1) {
      console.log(
        `  ${c.white}➜${c.reset}  ${c.dim}Workers:${c.reset} ${c.magenta}${workerCount}${c.reset}`
      )
    }
    console.log(
      `  ${c.white}➜${c.reset}  press ${c.bold}h + enter${c.reset} ${c.dim}to show help${c.reset}\n`
    )
  }

  // ─── Graceful Shutdown ────────────────────────────────────────────────────────

  onShutdown(hook: () => Promise<void> | void): this {
    this.shutdownHooks.push(hook)
    return this
  }

  close(timeout = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      this.log.info('Initiating graceful shutdown')

      let finishCalled = false
      const finish = async () => {
        if (finishCalled) return
        finishCalled = true
        try {
          for (const hook of this.shutdownHooks) {
            await hook()
          }
          // Also execute onClose hooks
          for (const hook of this.hooks.close) {
            await hook()
          }
          if (this.onCloseHook) {
            await this.onCloseHook(this)
          }
          if (this._cronScheduler) {
            this._cronScheduler.stop()
          }
          if (this._queueWorker) {
            await this._queueWorker.stop()
          }
          if (this._queueClient) {
            await this._queueClient.close()
          }
          if ((this as any).hotReloader) {
            await (this as any).hotReloader.stop()
          }
          this.log.info('Graceful shutdown completed')
          resolve()
        } catch (err) {
          this.log.error({ err }, 'Error executing shutdown hooks')
          reject(err)
        }
      }

      if (!this._useUws && (!this.server || !this.server.listening)) {
        finish()
        return
      }

      if (this._useUws && !this._uwsListenToken) {
        finish()
        return
      }

      // Close idle keep-alive connections immediately
      if (
        !this._useUws &&
        this.server &&
        'closeIdleConnections' in this.server
      ) {
        ;(
          this.server as { closeIdleConnections?: () => void }
        ).closeIdleConnections?.()
      }

      // Set timeout to force close active connections
      const timer = setTimeout(() => {
        this.log.warn(
          `Shutdown timeout of ${timeout}ms exceeded, forcefully terminating active connections`
        )
        if (
          !this._useUws &&
          this.server &&
          'closeAllConnections' in this.server
        ) {
          ;(
            this.server as { closeAllConnections?: () => void }
          ).closeAllConnections?.()
        }
        finish() // Ensure finish is called on timeout
      }, timeout)

      const cleanupAndFinish = async () => {
        clearTimeout(timer)
        await finish()
      }

      this.wsServer.close()

      for (const client of this.rawWsServer.clients) {
        client.terminate()
      }
      this.rawWsServer.close()

      if (this.redirectServer) {
        this.redirectServer.close()
      }

      if (this._useUws && this._uwsApp) {
        this._uwsApp.close(this._uwsListenToken)
        this._uwsListenToken = null
        cleanupAndFinish()
      } else {
        this.server.close((err) => {
          if (err) reject(err)
          else cleanupAndFinish()
        })
      }
    })
  }

  // ─── Expose internals ─────────────────────────────────────────────────────────

  getRouter(): Router {
    return this.router
  }

  async loadAllRoutes(): Promise<void> {
    for (const [filePath, entry] of this.lazyRoutes.entries()) {
      if (!entry.loaded) {
        entry.loaded = true
        this.router.removeRoutesBySource('lazy:' + filePath)
        const routePath = this.routeMap.get(filePath)
        if (routePath) {
          try {
            await this.mountRouteFile(filePath, routePath)
          } catch (e) {
            this.log.error(
              { err: e, file: filePath },
              'Failed to eager-load route'
            )
          }
        }
      }
    }
  }

  getServer(): HttpServer | HttpsServer | Http2SecureServer {
    return this.server
  }

  getConfig(): ResolvedConfig {
    return this.options
  }

  // ─── App Initialization ────────────────────────────────────────────────────────

  private _configLoaded = false

  async create(cwd?: string): Promise<this> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    activeAppInstance = this
    const root = cwd ?? process.cwd()

    if (!this._configLoaded) {
      const { loadConfig } = await import('../utils/config')
      const fileConfig = await loadConfig(root)
      // File config takes precedence over defaults, but explicit options take highest precedence
      this.options = mergeConfig(defaultConfig, fileConfig)
      this.options = mergeConfig(this.options, this.explicitOptions)

      // Recreate logger now that the user's config has been loaded
      this._loggerCreated = false
      this.ensureLogger()

      this._configLoaded = true

      if (
        (process.env.__EXIS_DEV_SERVER || process.env.__EXIS_CLI) &&
        !process.env.__EXIS_REPL &&
        !process.env.__EXIS_TEST
      ) {
        await this._printStartupBanner()
      }
    }

    // Initialize Queue after config is loaded
    if (this.options.queue && !this._queueClient) {
      this._initQueue(this.options.queue)
    }

    // Flush any pending jobs that were registered before config was loaded
    if (this._pendingQueueJobs.length > 0) {
      if (!this._queueWorker) {
        if (this.options.queue?.enableWorkers !== false) {
          throw new Error(
            'Queue worker is not initialized. Please configure ExisConfig.queue first.'
          )
        }
      } else {
        for (const job of this._pendingQueueJobs) {
          this._queueWorker.registerJob(job as any)
          if (this._cronScheduler && job.cron) {
            this._cronScheduler.registerJob(job as any)
          }
        }
      }
      this._pendingQueueJobs = []
    }

    if (this._routesMounted) return this

    // Automatically scan and mount file-based routes and jobs
    await this.autoMountRoutes(root)
    await this.autoMountJobs(root)
    this._routesMounted = true

    // Start Hot Route Reloading in dev mode
    if (this.options.env === 'development' && (this as any)._allApiDirs) {
      this.hotReloader = new HotReloader({
        apiDirs: (this as any)._allApiDirs,
        router: this.router,
        routeMap: this.routeMap,
        mountRoute: (filePath, routePath) =>
          this.mountRouteFile(filePath, routePath),
      })
      await this.hotReloader.start()
    }

    return this
  }

  // ─── Auto-Mount File-Based Routes ─────────────────────────────────────────────

  private async autoMountRoutes(root: string): Promise<void> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')

    const isProd = process.env.NODE_ENV === 'production'
    const isDev = this.options.env === 'development'

    // Try to load the pre-built manifest first (O(1) boot)
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
        const manifest = mod.manifest

        if (Array.isArray(manifest)) {
          for (const entry of manifest) {
            const { routePath, module: routeMod, filePath } = entry
            const normalizedPath = path.resolve(root, filePath)
            this.routeMap.set(normalizedPath, routePath)
            const CONTROLLER_PREFIX = Symbol.for('exisjs:controller_prefix')
            const isClassController = (obj: any) =>
              obj &&
              obj.prototype &&
              obj.prototype[CONTROLLER_PREFIX] !== undefined

            const unwrappedMod =
              routeMod.default && routeMod.default.default
                ? routeMod.default.default
                : routeMod.default
                  ? routeMod.default
                  : routeMod

            const functionalControllerObj =
              unwrappedMod && unwrappedMod.__isController ? unwrappedMod : null

            const routerInstance =
              routeMod.router || routeMod.default || routeMod

            if (functionalControllerObj) {
              const router = this.compileFunctionalController(
                functionalControllerObj
              )
              this.mountRouteWithSource(routePath, router, normalizedPath)
            } else if (isClassController(routerInstance)) {
              this.registerControllers([routerInstance], routePath)
            } else {
              this.mountRouteWithSource(
                routePath,
                routerInstance,
                normalizedPath
              )
            }
          }
          // Skip the filesystem scan completely!
          return
        }
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.warn('exisjs: Failed to load routes manifest:', err.message)
      }
      // Fall back to scanning the filesystem
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
                this.router.removeRoutesBySource('lazy:' + lazyKey)
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
                await this.router.handle(req, res, next)
              } else {
                next?.()
              }
            }

            const lazyRouter = new Router()
            lazyRouter.all(routePath, lazyHandler)
            lazyRouter.all(routePath + '/*path', lazyHandler)
            for (const r of lazyRouter.getRoutes()) {
              r.sourceFile = 'lazy:' + lazyKey
              this.router.addRawRoute(r)
            }
          } else {
            try {
              await this.mountRouteFile(normalized, routePath)
            } catch (err) {
              this.log.error(
                { err, file: filePath },
                `Failed to load route file: ${filePath}`
              )
            }
          }
        }
      }
    }
  }

  // ─── Route File Mounting (shared by autoMount and HotReloader) ──────────────

  // ─── Auto-Mount File-Based Jobs ──────────────────────────────────────────────

  private async autoMountJobs(root: string): Promise<void> {
    if (!this._queueWorker) return

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
              this._queueWorker.registerJob(def)

              if (this._cronScheduler && jobDef.cron) {
                this._cronScheduler.registerJob(def)
              }
              this.log.info(`Registered background job: ${name}`)
            }
          } catch (err) {
            this.log.error(`Failed to load job file ${filePath}: ${err}`)
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
                await this.register(plugin)
              }
            }
            if (gwConfig.imports) {
              for (const mod of gwConfig.imports) {
                const name = 'plugin' in mod ? mod.plugin.name : mod.name
                if (!this.hasPlugin(name)) {
                  await this.register(mod)
                }
              }
            }
            if (gwConfig.providers) {
              for (const [token, providerConfig] of gwConfig.providers) {
                this.provide(token, providerConfig)
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
    else if (allCors === undefined && this.options.cors !== undefined)
      allCors = this.options.cors

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
        await this.register(plugin)
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
      this.registerControllers([unwrappedMod], routePath, prefixMiddlewares)
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
      this.log.warn(
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
          const ctx = {
            body: req.body,
            query: req.query,
            params: req.params,
            headers: req.headers,
            req,
            res,
            app: this,
            socket: (req as any).ws,
            ...req, // Spread req to allow access to user, session, etc.
          }

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
        schema.body = isValidatorOrPipe(rc.body) ? rc.body : v.object(rc.body)
      }
      if (rc.query) {
        schema.query = isValidatorOrPipe(rc.query)
          ? rc.query
          : v.object(rc.query)
      }
      if (rc.params) {
        schema.params = isValidatorOrPipe(rc.params)
          ? rc.params
          : v.object(rc.params)
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
              app: this,
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
      this.router.addRawRoute(r)

      if (this.hooks.route.length > 0) {
        // eslint-disable-next-line @typescript-eslint/prefer-for-of
        for (let i = 0; i < this.hooks.route.length; i++) {
          this.hooks.route[i]({ method: route.method, path: fullPath })
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

  // ─── Queues ─────────────────────────────────────────────────────────────────

  /**
   * Registers a background job worker handler.
   */
  public queue<T = unknown>(
    name: string,
    handler: import('../queue/types').JobHandler<T>,
    options?: Omit<
      import('../queue/types').JobDefinition<T>,
      'name' | 'handler'
    >
  ) {
    if (!this._queueWorker) {
      if (this.options.queue?.enableWorkers === false) {
        // workers disabled explicitly, gracefully skip registering
        return
      }
      // Worker not initialized yet (e.g. config loading is pending), buffer the job
      this._pendingQueueJobs.push({
        name,
        handler: handler as import('../queue/types').JobHandler<unknown>,
        ...options,
      } as any)
      return
    }
    this._queueWorker.registerJob({
      name,
      handler: handler as import('../queue/types').JobHandler<unknown>,
      ...options,
    } as any)
  }

  /**
   * Enqueues a payload for background processing.
   */
  public async enqueue<T = unknown>(
    name: string,
    payload: T,
    opts?: JobOptions
  ): Promise<string> {
    if (!this._queueClient) {
      throw new Error(
        `Queue is not initialized. Please configure ExisConfig.queue first.`
      )
    }
    return this._queueClient.enqueue(name, payload, opts)
  }

  private _initQueue(qConfig: NonNullable<ExisConfig['queue']>) {
    if (!this._queueClient) {
      this._queueClient = new ExisQueue(qConfig)
    }
    const enableWorkers = qConfig.enableWorkers ?? true
    if (enableWorkers && !this._queueWorker) {
      this._queueWorker = new ExisWorker(
        qConfig,
        this.log,
        this._queueClient.getDriver()
      )
      this._queueWorker.start()

      const redisClient = (this._queueWorker as any).redis || null
      this._cronScheduler = new CronScheduler(
        this._queueWorker,
        redisClient,
        this.log
      )
      this._cronScheduler.start()
    }
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const app = new App()

export let activeAppInstance: App | null = null

export function getActiveApp(): App {
  return activeAppInstance || app
}
