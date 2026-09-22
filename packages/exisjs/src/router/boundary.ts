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

export interface BoundaryConfig<TContext = Record<string, any>> {
  /**
   * Middleware to apply to all routes in this directory and subdirectories.
   * Replaces the old router.use() globally for a folder.
   */
  middleware?:
    | Handler<any, any, any, any, TContext>[]
    | Handler<any, any, any, any, TContext>
  /**
   * Alias for `middleware`. Supports plural naming.
   */
  middlewares?:
    | Handler<any, any, any, any, TContext>[]
    | Handler<any, any, any, any, TContext>

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
    | ((
        req: import('../types').Request<any, any, any, TContext>
      ) => number | undefined)

  /**
   * Cascading metadata (e.g., OpenAPI tags, roles) applied to all routes in this directory.
   */
  metadata?: Record<string, any>

  /**
   * Opt-in security scanner noise suppression & exploit probe blocker.
   * Intercepts automated vulnerability scanner probes (e.g. `/.env`, `/.git`, `/.DS_Store`)
   * and blackholes them immediately without running downstream handlers or flooding error logs.
   */
  blockProbes?: boolean | import('../middleware/security').BlockProbesOptions
  blockSuspiciousProbes?:
    boolean | import('../middleware/security').BlockProbesOptions

  /**
   * Hook executed immediately before any route handler in this boundary.
   * Can short-circuit execution by returning `false` or sending a response directly.
   */
  beforeHandle?:
    BoundaryBeforeHandleHook<TContext> | BoundaryBeforeHandleHook<TContext>[]

  /**
   * Hook executed immediately after a route handler in this boundary successfully returns.
   * Receives `(req, res, data)` and can transform the outgoing payload or perform audit logging.
   */
  afterHandle?:
    | BoundaryAfterHandleHook<any, TContext>
    | BoundaryAfterHandleHook<any, TContext>[]
}

export type { BlockProbesOptions } from '../middleware/security'

export type BoundaryBeforeHandleHook<TContext = Record<string, any>> = (
  req: import('../types').Request<any, any, any, TContext>,
  res: import('../types').Response
) => void | boolean | Promise<void | boolean>

export type BoundaryAfterHandleHook<T = any, TContext = Record<string, any>> = (
  req: import('../types').Request<any, any, any, TContext>,
  res: import('../types').Response,
  data?: T
) => void | any | Promise<void | any>

/**
 * Defines a boundary configuration that acts as a folder-scoped request pipeline
 * for all routes in its directory and subdirectories.
 *
 * @param config Boundary options (middleware, guards, interceptors, CORS, hooks, exclusions)
 * @returns Strongly typed `BoundaryConfig`
 *
 * @example
 * ```ts
 * // src/http/api/admin/boundary.ts
 * export default defineBoundary({
 *   guards: [AdminGuard],
 *   cors: { origin: 'https://admin.example.com' },
 *   beforeHandle(req, res) {
 *     if (!req.user) {
 *       res.status(401).json({ error: 'Unauthorized' })
 *       return false // halts execution
 *     }
 *   },
 *   afterHandle(req, res, data) {
 *     // Audit logging / payload wrapping
 *     return { data, timestamp: Date.now() }
 *   }
 * })
 * ```
 */
export function defineBoundary<TContext = Record<string, any>>(
  config: BoundaryConfig<TContext>
): BoundaryConfig<TContext> {
  return config
}
