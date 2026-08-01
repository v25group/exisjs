import { IncomingMessage, ServerResponse } from 'node:http'
import type { Server as HttpServer } from 'node:http'
import type { Server as HttpsServer } from 'node:https'
import type { Http2SecureServer } from 'node:http2'
import { WebSocketServer } from 'ws'
import { Router } from '../router/router'
import {
  cors,
  helmet,
  requestId,
  requestLogger,
  compression,
} from '../middleware/middleware'
import { createErrorHandler } from '../utils/errors'
import { ExisWebSocketServer } from '../websocket/server'
import { defaultConfig, mergeConfig } from '../utils/config'
import type { ResolvedConfig } from '../utils/config'
import { createLogger, resolveLoggerConfig } from '../utils/logger'
import { HotReloader } from './hot-reload'
import {
  createUwsApp,
  UwsIncomingMessage,
  UwsServerResponse,
} from './uws-adapter'
import type { UwsListenToken } from './uws-adapter'
import type { JobOptions } from '../queue/types'
import { Container } from '../di/container'
import type { ProviderToken, ProviderDefinition } from '../di/container'

import type {
  Handler,
  ErrorHandler,
  ExisConfig,
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

import { ServerBootstrapper } from './bootstrapper'
import { WsOrchestrator } from './ws-orchestrator'
import { PluginManager } from './plugin-manager'
import { RouteScanner } from './route-scanner'
import { QueueManager } from './queue-manager'
import { RequestHandler } from './request-handler'
import { ControllerRegistrar } from './controller-registrar'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class App<TRoutes extends Record<string, any> = {}> {
  public bootstrapper!: ServerBootstrapper
  public wsOrchestrator!: WsOrchestrator
  get server() {
    return this.bootstrapper.getServer()
  }
  get redirectServer() {
    return (this.bootstrapper as any).redirectServer
  }
  public router: Router
  public options: ResolvedConfig
  public globalMiddleware: Handler[] = []
  private errorHandlers: ErrorHandler[] = []
  private _configured = false
  private _routesMounted = false
  private _loggerCreated = false
  public hotReloader: HotReloader | null = null

  public wsServer = new ExisWebSocketServer()
  public rawWsServer = new WebSocketServer({ noServer: true })

  // ─── Component Managers ───────────────────────────────────────────────────
  public pluginManager: PluginManager
  public routeScanner: RouteScanner
  public queueManager: QueueManager
  public requestHandler: RequestHandler
  public controllerRegistrar: ControllerRegistrar

  get onStartHook() {
    return this.pluginManager.onStartHook
  }
  set onStartHook(cb) {
    this.pluginManager.onStartHook = cb
  }

  get onCloseHook() {
    return this.pluginManager.onCloseHook
  }
  set onCloseHook(cb) {
    this.pluginManager.onCloseHook = cb
  }

  // ─── uWebSockets.js Backend ──────────────────────────────────────────────────
  private _useUws = false

  private _uwsApp: ReturnType<typeof createUwsApp> | null = null
  private _uwsListenToken: UwsListenToken | null = null

  // ─── Lifecycle Hooks Registry ───────────────────────────────────────────────
  get hooks() {
    return this.pluginManager.hooks
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
  public get apiDir(): string | null {
    return this.routeScanner.apiDir
  }
  public set apiDir(val: string | null) {
    this.routeScanner.apiDir = val
  }
  public get _queueClient() {
    return this.queueManager._queueClient
  }
  public get _queueWorker() {
    return this.queueManager._queueWorker
  }
  public get _cronScheduler() {
    return this.queueManager._cronScheduler
  }
  public get _pendingQueueJobs() {
    return this.queueManager._pendingQueueJobs
  }
  public set _pendingQueueJobs(v) {
    this.queueManager._pendingQueueJobs = v
  }

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

    this.pluginManager = new PluginManager(this)
    this.wsOrchestrator = new WsOrchestrator(this)
    this.bootstrapper = new ServerBootstrapper(this)
    this.routeScanner = new RouteScanner(this)
    this.queueManager = new QueueManager(this)
    this.requestHandler = new RequestHandler(this)
    this.controllerRegistrar = new ControllerRegistrar(this)

    if (this.options.queue) {
      this.queueManager._initQueue(this.options.queue)
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

  // _initServer logic has been moved to ServerBootstrapper

  // ─── Lifecycle Hooks Registration ───────────────────────────────────────────
  onReady(cb: HookReady): this {
    this.pluginManager.onReady(cb)
    return this
  }
  onClose(cb: HookClose): this {
    this.pluginManager.onClose(cb)
    return this
  }
  onRequest(cb: HookRequest): this {
    this.pluginManager.onRequest(cb)
    return this
  }
  onResponse(cb: HookResponse): this {
    this.pluginManager.onResponse(cb)
    return this
  }
  onError(cb: HookError): this {
    this.pluginManager.onError(cb)
    return this
  }
  onRoute(cb: HookRoute): this {
    this.pluginManager.onRoute(cb)
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
    return this.pluginManager.hasPlugin(name)
  }

  public async register<TOptions = Record<string, unknown>>(
    pluginOrInstance: ExisPlugin<TOptions> | ExisPluginInstance,
    legacyOptions?: TOptions
  ): Promise<this> {
    await this.pluginManager.register(pluginOrInstance, legacyOptions)
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
    this.controllerRegistrar.registerControllers(
      controllers,
      basePath,
      prefixMiddlewares
    )
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

  public applyBuiltins(): void {
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

  public async fetch(
    request: globalThis.Request,
    env?: any,
    ctx?: any
  ): Promise<globalThis.Response> {
    return this.requestHandler.fetch(request, env, ctx)
  }

  public async inject(options: {
    method?: string
    url: string
    headers?: Record<string, string>
    body?: any
  }): Promise<import('../testing/client').TestResponse> {
    return this.requestHandler.inject(options)
  }

  // ─── Private Internal Pipeline Handler ─────────────────────────────────────────────────────

  public getCompiledPipeline(): Handler[] {
    return this.requestHandler.getCompiledPipeline()
  }

  public handle(rawReq: IncomingMessage, rawRes: ServerResponse): void {
    this.requestHandler.handle(rawReq, rawRes)
  }

  /**
   * Handle a request from the uWebSockets.js backend.
   * Uses the same middleware pipeline as Node HTTP but with uWS shims.
   */
  public handleUws(
    shimReq: UwsIncomingMessage,
    shimRes: UwsServerResponse
  ): void {
    this.requestHandler.handleUws(shimReq, shimRes)
  }

  public getErrorHandlers() {
    return this.errorHandlers
  }

  // WebSocket Upgrade logic has been moved to WsOrchestrator

  private shutdownHooks: (() => Promise<void> | void)[] = []

  // ─── Listen ───────────────────────────────────────────────────────────────────

  getServer(): HttpServer | HttpsServer | Http2SecureServer {
    return this.bootstrapper.getServer()
  }

  getConfig(): ResolvedConfig {
    return this.options
  }

  // ─── App Initialization ───────────────────────────────────────────────────────

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

      if (this.options.env === 'development') {
        const { getAvailablePort } = await import('../utils/port')
        const requestedPort = this.options.port || 3000
        const host = this.options.host || '0.0.0.0'
        const availablePort = await getAvailablePort(requestedPort, host)
        if (availablePort !== requestedPort) {
          this.log.info(
            `Port ${requestedPort} is in use, using ${availablePort} instead.`
          )
        }
        this.options.port = availablePort
      }

      if (
        (process.env.__EXIS_DEV_SERVER || process.env.__EXIS_CLI) &&
        !process.env.__EXIS_REPL &&
        !process.env.__EXIS_TEST
      ) {
        await this._printStartupBanner()
      }
    }

    // Initialize Queue after config is loaded
    if (this.options.queue && !this.queueManager._queueClient) {
      this.queueManager._initQueue(this.options.queue)
    }

    // Flush any pending jobs that were registered before config was loaded
    if (this.queueManager._pendingQueueJobs.length > 0) {
      if (!this.queueManager._queueWorker) {
        if (this.options.queue?.enableWorkers !== false) {
          throw new Error(
            'Queue worker is not initialized. Please configure ExisConfig.queue first.'
          )
        }
      } else {
        for (const job of this.queueManager._pendingQueueJobs) {
          this.queueManager._queueWorker.registerJob(job as any)
          if (this.queueManager._cronScheduler && job.cron) {
            this.queueManager._cronScheduler.registerJob(job as any)
          }
        }
      }
      this.queueManager._pendingQueueJobs = []
    }

    if (this._routesMounted) return this

    // Automatically scan and mount file-based routes and jobs
    await this.routeScanner.autoMountRoutes(root)
    await this.routeScanner.autoMountJobs(root)
    this._routesMounted = true

    // Start Hot Route Reloading in dev mode
    if (
      this.options.env === 'development' &&
      (this.routeScanner as any)._allApiDirs
    ) {
      this.hotReloader = new HotReloader({
        apiDirs: (this.routeScanner as any)._allApiDirs,
        router: this.router,
        routeMap: this.routeScanner.routeMap,
        mountRoute: (filePath, routePath) =>
          this.routeScanner.mountRouteFile(filePath, routePath),
      })
      await this.hotReloader.start()
    }

    return this
  }

  // ─── Listen ───────────────────────────────────────────────────────────────────

  listen(
    portOrOptions?: number | ListenOptions,
    callback?: () => void
  ): HttpServer | HttpsServer | Http2SecureServer {
    return this.bootstrapper.listen(portOrOptions, callback)
  }

  // ─── Banner ───────────────────────────────────────────────────────────────────
  public async _printStartupBanner(): Promise<void> {
    return this.bootstrapper.printStartupBanner()
  }

  // ─── Graceful Shutdown ────────────────────────────────────────────────────────

  onShutdown(hook: () => Promise<void> | void): this {
    this.bootstrapper.onShutdown(hook)
    return this
  }

  close(timeout = 5000): Promise<void> {
    return this.bootstrapper.close(timeout)
  }

  // ─── Expose internals ─────────────────────────────────────────────────────────

  getRouter(): Router {
    return this.router
  }

  // ─── Queues ─────────────────────────────────────────────────────────────────

  public queue<T = unknown>(
    name: string,
    handler: import('../queue/types').JobHandler<T>,
    options?: Omit<
      import('../queue/types').JobDefinition<T>,
      'name' | 'handler'
    >
  ) {
    return this.queueManager.queue(name, handler, options)
  }

  public async enqueue<T = unknown>(
    name: string,
    payload: T,
    opts?: JobOptions
  ): Promise<string> {
    return this.queueManager.enqueue(name, payload, opts)
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const app = new App()

export let activeAppInstance: App | null = null

export function getActiveApp(): App {
  return activeAppInstance || app
}
