import type { ExisRequest } from '../server/request'
import type { ExisResponse } from '../server/response'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ExisUser {}

export type Request<
  TBody = unknown,
  TQuery = Record<string, string>,
  TParams = Record<string, string>,
  TContext = Record<string, any>,
> = ExisRequest<TBody, TQuery, TParams> & TContext

export type Response<TResponse = any> = ExisResponse<TResponse>

export interface ExisFile {
  fieldname: string
  filename: string
  mimetype: string
  data: Buffer
  /** Alias for data for Multer / standard Node compatibility */
  buffer?: Buffer
  size: number
  /** Disk destination path if saved to disk */
  path?: string

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
  sameSite?: 'Strict' | 'Lax' | 'None' | 'strict' | 'lax' | 'none' | boolean
  path?: string
  domain?: string
  partitioned?: boolean
  priority?: 'low' | 'medium' | 'high'
}

export type NextFunction = (err?: Error) => void

export type Handler<
  TBody = unknown,
  TQuery = Record<string, string>,
  TParams = Record<string, string>,
  TResponse = any,
  TContext = Record<string, any>,
> = (
  req: Request<TBody, TQuery, TParams, TContext>,
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

export type RouteValidator<T> =
  | { parse: (val: unknown) => T; transform?: unknown }
  | { parse?: unknown; transform: (val: unknown, meta?: any) => Promise<T> | T }

export interface RouteUploadOptions {
  field?: string
  fields?: { name: string; maxCount?: number }[]
  maxCount?: number
  dest?: string
  destination?: 'memory' | 'disk' | 'stream' | string
  storage?: 'disk' | 'memory'
  allowedMimeTypes?: string[]
  mimeTypes?: string[]
  maxBytes?: number
  maxSize?: number | string
  limits?: {
    fileSize?: number
    files?: number
  }
}

export interface RouteSchema<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
  TResponse = unknown,
  _TContext = Record<string, any>,
> {
  response?: TResponse
  body?: RouteValidator<TBody>
  query?: RouteValidator<TQuery>
  params?: RouteValidator<TParams>
  upload?: RouteUploadOptions | string
  timeout?: number | { ms: number; statusCode?: number; message?: string }
  timeoutMs?: number
  host?: string | string[]
  filters?: any | any[]
  metadata?: Record<string, any>
  permissions?: string[]
}

export type InferZod<S> = S extends { parse: (val: unknown) => infer U }
  ? U
  : S extends { parse: (val: any) => infer U }
    ? U
    : unknown
export type InferSchemaBody<S> = S extends { body: infer B }
  ? InferZod<B>
  : unknown
export type InferSchemaQuery<S> = S extends { query: infer Q }
  ? InferZod<Q> extends unknown
    ? unknown extends InferZod<Q>
      ? Record<string, string>
      : InferZod<Q>
    : InferZod<Q>
  : Record<string, string>
export type InferSchemaParams<S> = S extends { params: infer P }
  ? InferZod<P> extends unknown
    ? unknown extends InferZod<P>
      ? Record<string, string>
      : InferZod<P>
    : InferZod<P>
  : Record<string, string>
export type InferSchemaResponse<S> = S extends { response: infer R }
  ? R extends { parse: any }
    ? InferZod<R>
    : any
  : any

export type InferHandler<S extends RouteSchema<any, any, any, any, any>> =
  Handler<
    InferSchemaBody<S>,
    InferSchemaQuery<S>,
    InferSchemaParams<S>,
    InferSchemaResponse<S>,
    Record<string, any> // TContext is typically inferred at the route definition level
  >

export type RouteHandler<
  TBody = unknown,
  TQuery = Record<string, string>,
  TParams = Record<string, string>,
  TResponse = unknown,
  TContext = Record<string, any>,
> =
  | Handler<TBody, TQuery, TParams, TResponse, TContext>
  | RouteSchema<TBody, TQuery, TParams, TResponse, TContext>

export interface Route {
  method: HttpMethod | 'ALL'
  path: string
  handlers: Handler<any, any, any, any, any>[]
  sourceFile?: string
  schema?: RouteSchema<any, any, any, any, any>
  host?: string | string[]
  _serializer?: (data: unknown) => string
}

export interface RouteMatch {
  route: Route
  params: Record<string, string>
}
