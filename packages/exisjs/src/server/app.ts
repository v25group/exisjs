import { IncomingMessage, ServerResponse } from 'node:http'
import type { Server as HttpServer } from 'node:http'
import type { Server as HttpsServer } from 'node:https'
import type { Http2SecureServer } from 'node:http2'
import { Router } from '../router/router'
import {
  cors,
  helmet,
  compress,
  requestId,
  requestLogger,
} from '../middleware/middleware'
import { createErrorHandler } from '../error/errors'
import { defaultConfig, mergeConfig } from '../config/config'
import type { ResolvedConfig } from '../config/config'
import { createLogger, resolveLoggerConfig } from '../utils/logger'
import { getLoggerInstance, isLoggerConfigured } from '../logger'
import { Container } from '../di/container'
import type { ProviderToken, ProviderDefinition } from '../di/container'
import { intercept } from '../middleware/interceptor'

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
import { PluginManager } from '../plugin/manager'
import { RouteScanner } from '../router/route-scanner'
import { RequestHandler } from './request-handler'
import { ControllerRegistrar } from '../router/controller-registrar'
import { CronManager } from '../cron/manager'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class App<TRoutes extends Record<string, any> = {}> {
  public bootstrapper!: ServerBootstrapper
  get server() {
    return this.bootstrapper.getServer()
  }
  get redirectServer() {
    return (this.bootstrapper.engine as any).redirectServer
  }
  public router: Router
  public options: ResolvedConfig
  public globalMiddleware: Handler[] = []
  private errorHandlers: ErrorHandler[] = []
  private _configured = false
  private _routesMounted = false
  private _loggerCreated = false

  // ─── Component Managers ───────────────────────────────────────────────────
  public pluginManager: PluginManager
  public routeScanner: RouteScanner
  public requestHandler: RequestHandler
  public controllerRegistrar: ControllerRegistrar
  public cron: CronManager

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

  // ─── Lifecycle Hooks Registry ───────────────────────────────────────────────
  get hooks() {
    return this.pluginManager.hooks
  }

  // ─── Public Logger ──────────────────────────────────────────────────────────
  public log!: Logger
  public explicitOptions: ExisConfig = {}

  // ─── Validation ─────────────────────────────────────────────────────────────
  public validatorCompiler?: (req: {
    schema: any
    httpPart: string
  }) => (data: any) => any

  public setValidatorCompiler(
    compiler: (req: { schema: any; httpPart: string }) => (data: any) => any
  ) {
    this.validatorCompiler = compiler
    this.router.validatorCompiler = compiler
    return this
  }

  // ─── Dependency Injection ───────────────────────────────────────────────────
  public container = new Container()

  public get apiDir(): string | null {
    return this.routeScanner.apiDir
  }
  public set apiDir(val: string | null) {
    this.routeScanner.apiDir = val
  }

  constructor(options: ExisConfig = {}) {
    this.explicitOptions = options
    this.options = mergeConfig(defaultConfig, options)
    this.router = new Router()
    this.ensureLogger()

    this.pluginManager = new PluginManager(this)
    this.bootstrapper = new ServerBootstrapper(this)
    this.routeScanner = new RouteScanner(this)
    this.requestHandler = new RequestHandler(this)
    this.controllerRegistrar = new ControllerRegistrar(this)
    this.cron = new CronManager(this)

    this.bootstrapper.onShutdown(() => this.cron.drain())
  }

  private ensureLogger() {
    if (this._loggerCreated) return
    this._loggerCreated = true

    // If the developer already called configureLogger() or setLogger(),
    // use their instance so everything shares the same output.
    if (isLoggerConfigured()) {
      this.log = getLoggerInstance()
      return
    }

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

  // ─── Introspection ──────────────────────────────────────────────────────────

  getRoutes(): import('../types').Route[] {
    return this.router.getRoutes()
  }

  // ─── Plugin System ──────────────────────────────────────────────────────────

  public hasPlugin(name: string): boolean {
    return this.pluginManager.hasPlugin(name)
  }

  public async register<TOptions = Record<string, unknown>>(
    pluginOrInstance: ExisPlugin<TOptions> | ExisPluginInstance | any,
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

    if (this.options.blockProbes || this.options.blockSuspiciousProbes) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { blockSuspiciousProbes } = require('../middleware/security')
      const probeOpts =
        typeof this.options.blockProbes === 'object'
          ? this.options.blockProbes
          : typeof this.options.blockSuspiciousProbes === 'object'
            ? this.options.blockSuspiciousProbes
            : {}
      this.globalMiddleware.unshift(blockSuspiciousProbes(probeOpts))
    }

    if (logOpt !== false) {
      this.globalMiddleware.push(requestLogger(this.log))
    }

    if (compressionOpt) {
      this.globalMiddleware.push(compress())
    }

    if (helmetOpt !== false) {
      this.globalMiddleware.push(helmet())
    }

    if (corsOpt !== false) {
      this.globalMiddleware.push(cors(corsOpt === true ? {} : corsOpt))
    }

    if (this.options.transformResponse) {
      const transformer =
        typeof this.options.transformResponse === 'function'
          ? this.options.transformResponse
          : (data: any, _req: any, res: any) => {
              // If already wrapped or is an error response, return as is
              if (
                data &&
                typeof data === 'object' &&
                ('success' in data || 'error' in data)
              ) {
                return data
              }
              const isSuccess = (res.statusCode || 200) < 400
              return isSuccess
                ? { success: true, data, timestamp: new Date().toISOString() }
                : data
            }
      this.globalMiddleware.push(intercept(transformer))
    }

    if (this.options.plugins) {
      for (const plugin of this.options.plugins) {
        if (!this.hasPlugin(plugin.name)) {
          // We can't await inside sync constructor easily, but plugins are usually sync in register.
          // For async plugins in config, they should be loaded before app starts.
          // App.register is async, so we'll push the promise and warn if it's not awaited
          this.register(plugin).catch((err) =>
            this.log.error(
              { err, plugin: plugin.name },
              `Failed to register plugin ${plugin.name} from config`
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

    // Healthcheck Route
    if (
      this.options.healthcheck &&
      typeof this.options.healthcheck === 'object' &&
      this.options.healthcheck.enabled
    ) {
      const hcPath = this.options.healthcheck.path || '/_health'
      const checks = this.options.healthcheck.checks || []

      this.get(hcPath as any, async (req, res) => {
        try {
          if (checks.length > 0) {
            const results = await Promise.all(checks.map((c) => c()))
            if (results.some((r) => r === false)) {
              return res
                .status(503)
                .json({ status: 'error', message: 'Health check failed' })
            }
          }
          return res.status(200).json({ status: 'ok' })
        } catch (err: any) {
          return res.status(503).json({ status: 'error', message: err.message })
        }
      })
    }

    // Metrics Route
  }

  public async inject(options: {
    method?: string
    url: string
    headers?: Record<string, string>
    body?: any
    payload?: any
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
      const { loadConfig } = await import('../config/config')
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

    if (this._routesMounted) return this

    // Automatically scan and mount file-based routes
    await this.routeScanner.autoMountRoutes(root)

    // Auto-register discovered Injectables
    const { INJECTABLE_REGISTRY } = await import('../decorators/core')
    for (const injectable of INJECTABLE_REGISTRY) {
      this.container.provide(injectable, { useClass: injectable })
    }

    this._routesMounted = true

    return this
  }

  async autoMountRoutes(root?: string): Promise<this> {
    await this.routeScanner.autoMountRoutes(root ?? process.cwd())
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
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const app = new App()

export let activeAppInstance: App | null = null

export function getActiveApp(): App {
  return activeAppInstance || app
}

export function setActiveAppInstance(instance: App) {
  activeAppInstance = instance
}
