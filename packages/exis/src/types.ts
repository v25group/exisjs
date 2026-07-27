import type { ExisRequest } from './server/request'
import type { ExisResponse } from './server/response'
import type { ExisWebSocket } from './websocket/socket'
import type { ExisSSE } from './server/sse'

export interface Request<
  TBody = unknown,
  TQuery = Record<string, string>,
  TParams = Record<string, string>,
> extends ExisRequest<TBody, TQuery, TParams> {}

export type Response<TResponse = any> = ExisResponse<TResponse>

export interface ExisFile {
  fieldname: string
  filename: string
  mimetype: string
  data: Buffer
  size: number

  /**
   * Helper method to securely save the file to disk.
   * Automatically generates a unique, collision-free filename.
   * @param destDirectory The directory to save the file in (e.g. 'uploads')
   * @returns The absolute path to the saved file
   */
  saveToDisk: (destDirectory: string) => Promise<string>
}

export interface CookieOptions {
  maxAge?: number
  expires?: Date
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  path?: string
  domain?: string
}

export type NextFunction = (err?: Error) => void

export type Handler<
  TBody = unknown,
  TQuery = Record<string, string>,
  TParams = Record<string, string>,
  TResponse = any,
> = (
  req: Request<TBody, TQuery, TParams>,
  res: Response<TResponse>,
  next: NextFunction
) =>
  | (unknown extends TResponse ? any : TResponse)
  | Promise<unknown extends TResponse ? any : TResponse>

export type ErrorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => void | Promise<void>

export type WsHandler<TBody = any, TQuery = any, TParams = any> = (
  ws: ExisWebSocket,
  req: Request<TBody, TQuery, TParams>
) => void | Promise<void>

export type SseHandler<TBody = any, TQuery = any, TParams = any> = (
  sse: ExisSSE,
  req: Request<TBody, TQuery, TParams>
) => void | Promise<void>

// ─── Route Types ─────────────────────────────────────────────────────────────

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'HEAD'
  | 'CONNECT'
  | 'TRACE'
  | 'QUERY'
  | 'ALL'
  | 'WS'
  | 'SSE'

export interface RouteSchema<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
  TResponse = unknown,
> {
  response?: TResponse
  body?:
    | { parse: (val: unknown) => TBody }
    | { transform: (val: unknown, meta?: any) => Promise<TBody> | TBody }
    | any
  query?:
    | { parse: (val: unknown) => TQuery }
    | { transform: (val: unknown, meta?: any) => Promise<TQuery> | TQuery }
    | any
  params?:
    | { parse: (val: unknown) => TParams }
    | { transform: (val: unknown, meta?: any) => Promise<TParams> | TParams }
    | any
  host?: string | string[]
  filters?: any | any[]
  metadata?: Record<string, any>
}

export type InferZod<S> = S extends { parse: (val: any) => infer U }
  ? U
  : unknown
export type InferSchemaBody<S> = S extends { body: infer B }
  ? B extends { parse: any }
    ? InferZod<B>
    : unknown
  : unknown
export type InferSchemaQuery<S> = S extends { query: infer Q }
  ? Q extends { parse: any }
    ? InferZod<Q>
    : Record<string, string>
  : Record<string, string>
export type InferSchemaParams<S> = S extends { params: infer P }
  ? P extends { parse: any }
    ? InferZod<P>
    : Record<string, string>
  : Record<string, string>
export type InferSchemaResponse<S> = S extends { response: infer R }
  ? R extends { parse: any }
    ? InferZod<R>
    : any
  : any

export type InferHandler<S extends RouteSchema<any, any, any, any>> = Handler<
  InferSchemaBody<S>,
  InferSchemaQuery<S>,
  InferSchemaParams<S>,
  InferSchemaResponse<S>
>

export type RouteHandler<
  TBody = unknown,
  TQuery = Record<string, string>,
  TParams = Record<string, string>,
  TResponse = unknown,
> =
  | Handler<TBody, TQuery, TParams>
  | RouteSchema<TBody, TQuery, TParams, TResponse>

export interface Route {
  method: HttpMethod | 'ALL' | 'WS'
  path: string
  handlers: Handler<any, any, any>[]
  sourceFile?: string
  schema?: RouteSchema<any, any, any, any>
  host?: string | string[]
  _serializer?: (data: unknown) => string
}

export interface RouteMatch {
  route: Route
  params: Record<string, string>
}

// ─── Config Types ─────────────────────────────────────────────────────────────

export interface CorsConfig {
  origin?: string | string[] | RegExp | RegExp[] | ((origin: string) => boolean)
  methods?: string[]
  allowedHeaders?: string[]
  exposedHeaders?: string[]
  credentials?: boolean
  maxAge?: number
  preflightContinue?: boolean
}

export interface LoggerConfig {
  level?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  pretty?: boolean
  redact?: string[]
}

// ─── Logger Types ─────────────────────────────────────────────────────────────

export interface LogFn {
  (msg: string, ...args: unknown[]): void
  (obj: Record<string, unknown>, msg?: string, ...args: unknown[]): void
}

export interface Logger {
  fatal: LogFn
  error: LogFn
  warn: LogFn
  info: LogFn
  debug: LogFn
  trace: LogFn
  silent: LogFn
  child(bindings: Record<string, unknown>): Logger
  level: string
}

export interface HelmetConfig {
  enabled?: boolean
  contentSecurityPolicy?: boolean
  xFrameOptions?: 'DENY' | 'SAMEORIGIN'
}

export interface KeepAliveConfig {
  timeoutMs?: number
  headersTimeoutMs?: number
  maxRequests?: number
}

export interface SslConfig {
  key: string | Buffer
  cert: string | Buffer
  passphrase?: string
}

export interface ExisConfig {
  port?: number
  host?: string
  cors?: CorsConfig | boolean
  logger?: LoggerConfig | boolean
  helmet?: HelmetConfig | boolean
  trustProxy?: boolean | number
  bodyLimit?: number // bytes, default 1mb
  env?: 'development' | 'production' | 'test'
  compression?: boolean
  keepAlive?: KeepAliveConfig | boolean
  ssl?: SslConfig
  http2?: boolean // Default true when SSL is provided
  redirectHttp?: boolean | number // If true, redirects port 80 to HTTPS port. If number, redirects that specific port.
  etag?: boolean // Default false. Set to true to enable ETag generation for all responses.
  /**
   * Optional. Server backend to use.
   * 'node' (default fallback) uses Node's native HTTP/HTTPS modules.
   * 'uws' uses uWebSockets.js for significantly higher throughput.
   * 'auto' will use uWS if installed, otherwise Node.
   */
  server?: 'auto' | 'node' | 'uws'
  queue?: import('./queue/types').QueueConfig
  plugins?: ExisPlugin[]
  test?: {
    include?: string[]
    exclude?: string[]
    setupFiles?: string[]
    concurrency?: boolean | number
    coverage?: boolean
  }
}

// ─── Plugin System ──────────────────────────────────────────────────────────────

export interface ExisPlugin<TOptions = Record<string, unknown>> {
  name: string
  version?: string
  dependencies?: string[]
  encapsulate?: boolean
  register: (
    app: import('./server/app').App,
    options?: TOptions
  ) => void | Promise<void>
}

export interface ExisPluginInstance {
  plugin: ExisPlugin<unknown>
  options?: unknown
}

// ─── Lifecycle Hooks ────────────────────────────────────────────────────────
export type HookReady = () => void | Promise<void>
export type HookClose = () => void | Promise<void>
export type HookRequest = (req: Request, res: Response) => void | Promise<void>
export type HookResponse = (req: Request, res: Response) => void | Promise<void>
export type HookError = (
  err: Error,
  req: Request,
  res: Response
) => void | Promise<void>
export type HookRoute = (route: {
  method: string
  path: string
}) => void | Promise<void>

// ─── App Types ────────────────────────────────────────────────────────────────

export interface ListenOptions {
  port?: number
  host?: string
  ssl?: SslConfig
  redirectHttp?: boolean | number
  onListen?: (address: { port: number; host: string }) => void
}
