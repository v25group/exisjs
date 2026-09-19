import type { Handler, CorsConfig, HttpMethod } from '../types'
import type { ProviderDefinition } from '../di/container'

export interface BoundaryContext {
  req: import('../types').Request<any, any, any>
  res: import('../types').Response
  app?: any
  [key: string]: any
}

export interface BoundaryExcludeRule {
  path: string
  methods?: HttpMethod[]
  method?: HttpMethod
}

export interface BoundaryConfig {
  /**
   * Middleware to apply to all routes in this directory and subdirectories.
   * Replaces the old router.use() globally for a folder.
   */
  middleware?: Handler[] | Handler
  /**
   * Alias for `middleware`. Supports plural naming.
   */
  middlewares?: Handler[] | Handler

  /**
   * CORS configuration applied to all routes in this directory and subdirectories.
   */
  cors?: CorsConfig | boolean

  /**
   * Default headers applied to all responses from routes in this directory.
   */
  headers?: Record<string, string>

  /**
   * Plugins to automatically register when this boundary is loaded.
   */
  plugins?: (
    import('../types').ExisPluginInstance | import('../types').ExisPlugin
  )[]

  /**
   * Module imports (other plugins or modules to load before this boundary).
   * These are automatically deduplicated so singletons are only initialized once.
   */
  imports?: (
    import('../types').ExisPluginInstance | import('../types').ExisPlugin
  )[]

  /**
   * Providers to register into the Dependency Injection container.
   */
  providers?: [string, ProviderDefinition<any>][]

  /**
   * Exclude specific routes or patterns from this boundary's middleware, guards, and filters.
   */
  exclude?: (string | BoundaryExcludeRule)[]

  /**
   * Exception filters to apply to all routes in this directory and subdirectories.
   */
  filters?: any[]

  /**
   * Authorization guards to apply to all routes in this directory and subdirectories.
   */
  guards?: any[]

  /**
   * Response interceptors to apply to all routes in this directory and subdirectories.
   */
  interceptors?: any[]

  /**
   * Folder-scoped request timeout (in milliseconds).
   * Can be a static number or a dynamic function evaluated per-request.
   */
  timeout?:
    | number
    | ((req: import('../types').Request<any, any, any>) => number | undefined)

  /**
   * Cascading metadata (e.g., OpenAPI tags, roles) applied to all routes in this directory.
   */
  metadata?: Record<string, any>

  /**
   * Hook executed immediately before any route handler in this boundary.
   * Can short-circuit execution by returning `false` or sending a response directly.
   */
  beforeHandle?: BoundaryBeforeHandleHook | BoundaryBeforeHandleHook[]

  /**
   * Hook executed immediately after a route handler in this boundary successfully returns.
   * Receives `(req, res, data)` and can transform the outgoing payload or perform audit logging.
   */
  afterHandle?: BoundaryAfterHandleHook | BoundaryAfterHandleHook[]
}

export type BoundaryBeforeHandleHook = (
  req: import('../types').Request<any, any, any>,
  res: import('../types').Response
) => void | boolean | Promise<void | boolean>

export type BoundaryAfterHandleHook<T = any> = (
  req: import('../types').Request<any, any, any>,
  res: import('../types').Response,
  data?: T
) => void | any | Promise<void | any>

/**
 * Defines a boundary that acts as folder-scoped config + request pipeline for
 * everything in this directory and subdirectories.
 */
export function defineBoundary(config: BoundaryConfig): BoundaryConfig {
  return config
}
