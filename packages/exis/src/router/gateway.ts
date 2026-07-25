import type { Handler, CorsConfig } from '../types'
import type { ProviderDefinition } from '../di/container'

export interface GatewayConfig {
  /**
   * Middleware to apply to all routes in this directory and subdirectories.
   * Replaces the old router.use() globally for a folder.
   */
  middleware?: Handler[]

  /**
   * CORS configuration applied to all routes in this directory and subdirectories.
   */
  cors?: CorsConfig | boolean

  /**
   * Default headers applied to all responses from routes in this directory.
   */
  headers?: Record<string, string>

  /**
   * Plugins to automatically register when this gateway is loaded.
   */
  plugins?: (
    | import('../types').ExisPluginInstance
    | import('../types').ExisPlugin
  )[]

  /**
   * Module imports (other plugins or modules to load before this gateway).
   * These are automatically deduplicated so singletons are only initialized once.
   */
  imports?: (
    | import('../types').ExisPluginInstance
    | import('../types').ExisPlugin
  )[]

  /**
   * Providers to register into the Dependency Injection container.
   */
  providers?: [string, ProviderDefinition<any>][]

  /**
   * Exclude specific routes or patterns from this gateway's middleware, guards, and filters.
   */
  exclude?: (string | { path: string; methods?: import('../types').HttpMethod[] })[]

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
  timeout?: number | ((req: import('../types').Request<any, any, any>) => number | undefined)

  /**
   * Cascading metadata (e.g., OpenAPI tags, roles) applied to all routes in this directory.
   */
  metadata?: Record<string, any>
}

/**
 * Defines a gateway that acts as the ultimate gatekeeper, controlling all traffic
 * flowing into its subdirectories.
 */
export function defineGateway(config: GatewayConfig): GatewayConfig {
  return config
}
