import type { HttpMethod, RouteSchema } from '../types'

// Store metadata on class prototypes using symbols to avoid reflect-metadata
export const ROUTE_REGISTRY = Symbol.for('exisjs:routes')
export const CONTROLLER_PREFIX = Symbol.for('exisjs:controller_prefix')
export const CONTROLLER_HOST = Symbol.for('exisjs:controller_host')
export const MIDDLEWARE_REGISTRY = Symbol.for('exisjs:middlewares')
export const ROUTE_METADATA = Symbol.for('exisjs:route_metadata')
export const LIFECYCLE_METADATA = Symbol.for('exisjs:lifecycle_metadata')
export const PARAM_METADATA = Symbol.for('exisjs:param_metadata')
export const SERVER_CONFIG = Symbol.for('exisjs:server_config')
export const GATEWAY_CONFIG = Symbol.for('exisjs:gateway_config')

export const ROUTE_META = Symbol.for('exisjs:route_meta')
export const METHOD_MIDDLEWARES = Symbol.for('exisjs:method_middlewares')
export const ROUTE_METADATA_PROP = Symbol.for('exisjs:route_metadata_prop')
export const LIFECYCLE_METADATA_PROP = Symbol.for(
  'exisjs:lifecycle_metadata_prop'
)
export const PARAM_METADATA_PROP = Symbol.for('exisjs:param_metadata_prop')

export interface RouteMeta {
  method: HttpMethod
  path: string
  schema?: RouteSchema<any, any, any, any>
  handlerName: string
}

export interface ControllerOptions {
  prefix?: string
  host?: string
}

export interface ServerConfig {
  plugins?: any[]
  providers?: any[]
  cron?: any[]
  queue?: any[]
}

export interface GatewayConfig {
  exclude?: any[]
  middleware?: any[]
  filters?: any[]
  guards?: any[]
  interceptors?: any[]
  timeout?: number | ((req: any) => number)
  metadata?: Record<string, any>
  cors?: any
  headers?: Record<string, string>
  imports?: any[]
  providers?: any[]
}
