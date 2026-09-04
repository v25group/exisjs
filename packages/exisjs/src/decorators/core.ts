import {
  CONTROLLER_PREFIX,
  CONTROLLER_HOST,
  ROUTE_REGISTRY,
  MIDDLEWARE_REGISTRY,
  ROUTE_METADATA,
  LIFECYCLE_METADATA,
  PARAM_METADATA,
  ROUTE_META,
  METHOD_MIDDLEWARES,
  ROUTE_METADATA_PROP,
  LIFECYCLE_METADATA_PROP,
  PARAM_METADATA_PROP,
  SERVER_CONFIG,
  GATEWAY_CONFIG,
} from './constants'
import type {
  ControllerOptions,
  ServerConfig,
  GatewayConfig,
} from './constants'
import { MetadataEngine } from './core/metadata'

/**
 * Marks a class as a controller, automatically grouping its routes under the provided prefix.
 * Uses standard ES decorators, completely avoiding reflect-metadata bloat.
 *
 * Example:
 *
 *     @Controller('/api/users')
 *     export class UserController {
 *       @Get()
 *       getUsers() { return []; }
 *     }
 *
 * @param {string | ControllerOptions} [prefixOrOptions] Route prefix or options
 * @public
 */
export function Controller(prefixOrOptions?: string | ControllerOptions): any {
  return function (target: any, context?: ClassDecoratorContext) {
    const prefix =
      typeof prefixOrOptions === 'string'
        ? prefixOrOptions
        : prefixOrOptions?.prefix || ''
    const host =
      typeof prefixOrOptions === 'object' ? prefixOrOptions.host : undefined

    const proto = target.prototype
    MetadataEngine.set(proto, CONTROLLER_PREFIX, prefix)
    if (host) MetadataEngine.set(proto, CONTROLLER_HOST, host)

    if (context && context.metadata) {
      context.metadata[CONTROLLER_PREFIX] = prefix
      if (host) context.metadata[CONTROLLER_HOST] = host
    }

    MetadataEngine.init(proto, ROUTE_REGISTRY, [])

    // Middlewares
    const currentMiddlewares = MetadataEngine.get(proto, MIDDLEWARE_REGISTRY)
    if (Array.isArray(currentMiddlewares)) {
      MetadataEngine.set(proto, MIDDLEWARE_REGISTRY, {
        _classMiddlewares: currentMiddlewares,
      })
    } else if (!currentMiddlewares || typeof currentMiddlewares !== 'object') {
      MetadataEngine.set(proto, MIDDLEWARE_REGISTRY, { _classMiddlewares: [] })
    } else if (!currentMiddlewares._classMiddlewares) {
      currentMiddlewares._classMiddlewares = []
    }

    const classLifecycle =
      MetadataEngine.get(proto, LIFECYCLE_METADATA_PROP) || {}
    MetadataEngine.init(proto, ROUTE_METADATA, {})
    MetadataEngine.init(proto, LIFECYCLE_METADATA, {})
    MetadataEngine.init(proto, PARAM_METADATA, {})

    const routeRegistry = MetadataEngine.get(proto, ROUTE_REGISTRY)
    const middlewareRegistry = MetadataEngine.get(proto, MIDDLEWARE_REGISTRY)
    const routeMetadataMap = MetadataEngine.get(proto, ROUTE_METADATA)
    const lifecycleMetadataMap = MetadataEngine.get(proto, LIFECYCLE_METADATA)
    const paramMetadataMap = MetadataEngine.get(proto, PARAM_METADATA)

    for (const key of Object.getOwnPropertyNames(proto)) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, key)
      if (descriptor && typeof descriptor.value === 'function') {
        const fn = descriptor.value

        const routeMeta = MetadataEngine.get(fn, ROUTE_META)
        if (routeMeta) {
          routeRegistry.push({ ...routeMeta, handlerName: key })
        }

        const methodMiddlewares = MetadataEngine.get(fn, METHOD_MIDDLEWARES)
        if (methodMiddlewares) {
          middlewareRegistry[key] = middlewareRegistry[key] || []
          middlewareRegistry[key].push(...methodMiddlewares)
        }

        const classRouteMetadata =
          MetadataEngine.get(proto, ROUTE_METADATA_PROP) || {}
        const routeMetadata = MetadataEngine.get(fn, ROUTE_METADATA_PROP) || {}
        if (
          Object.keys(classRouteMetadata).length > 0 ||
          Object.keys(routeMetadata).length > 0
        ) {
          routeMetadataMap[key] = { ...classRouteMetadata, ...routeMetadata }
        }

        const lifecycleMetadata =
          MetadataEngine.get(fn, LIFECYCLE_METADATA_PROP) || {}
        lifecycleMetadataMap[key] = {
          guards: [
            ...(classLifecycle._classGuards || []),
            ...(lifecycleMetadata.guards || []),
          ],
          interceptors: [
            ...(classLifecycle._classInterceptors || []),
            ...(lifecycleMetadata.interceptors || []),
          ],
          filters: [
            ...(classLifecycle._classFilters || []),
            ...(lifecycleMetadata.filters || []),
          ],
        }

        const paramMetadata = MetadataEngine.get(fn, PARAM_METADATA_PROP)
        if (paramMetadata) {
          paramMetadataMap[key] = paramMetadata
        }
      }
    }
  }
}

export function Injectable(options?: { scope?: 'singleton' | 'request' }): any {
  return function (target: any, _context?: ClassDecoratorContext) {
    if (options?.scope) {
      MetadataEngine.set(
        target.prototype,
        Symbol.for('exisjs:scope'),
        options.scope
      )
    }
  }
}

/**
 * Marks a class as a root Server module.
 */
export function Server(options?: ServerConfig): any {
  return function (target: any, _context?: ClassDecoratorContext) {
    MetadataEngine.set(target.prototype, SERVER_CONFIG, options || {})
  }
}

/**
 * Marks a class as a Gateway module.
 */
export function Gateway(options?: GatewayConfig): any {
  return function (target: any, _context?: ClassDecoratorContext) {
    MetadataEngine.set(target.prototype, GATEWAY_CONFIG, options || {})
  }
}
