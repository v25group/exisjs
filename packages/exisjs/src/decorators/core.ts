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

    target.prototype[CONTROLLER_PREFIX] = prefix
    if (host) target.prototype[CONTROLLER_HOST] = host

    if (context && context.metadata) {
      context.metadata[CONTROLLER_PREFIX] = prefix
      if (host) context.metadata[CONTROLLER_HOST] = host
    }

    // Aggregate metadata from methods to the prototype registry
    const proto = target.prototype
    proto[ROUTE_REGISTRY] = proto[ROUTE_REGISTRY] || []

    // Middlewares
    const currentMiddlewares = proto[MIDDLEWARE_REGISTRY]
    if (Array.isArray(currentMiddlewares)) {
      proto[MIDDLEWARE_REGISTRY] = {
        _classMiddlewares: currentMiddlewares,
      }
    } else if (
      !proto[MIDDLEWARE_REGISTRY] ||
      typeof proto[MIDDLEWARE_REGISTRY] !== 'object'
    ) {
      proto[MIDDLEWARE_REGISTRY] = {
        _classMiddlewares: [],
      }
    } else if (!proto[MIDDLEWARE_REGISTRY]._classMiddlewares) {
      proto[MIDDLEWARE_REGISTRY]._classMiddlewares = []
    }

    // Response Metadata, Guards/Interceptors, and Parameters
    const classLifecycle = proto[LIFECYCLE_METADATA_PROP] || {}
    proto[ROUTE_METADATA] = proto[ROUTE_METADATA] || {}
    proto[LIFECYCLE_METADATA] = proto[LIFECYCLE_METADATA] || {}
    proto[PARAM_METADATA] = proto[PARAM_METADATA] || {}

    for (const key of Object.getOwnPropertyNames(proto)) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, key)
      if (descriptor && typeof descriptor.value === 'function') {
        const fn = descriptor.value

        // 1. Collect route definition
        const routeMeta = fn[ROUTE_META]
        if (routeMeta) {
          proto[ROUTE_REGISTRY].push({
            method: routeMeta.method,
            path: routeMeta.path,
            schema: routeMeta.schema,
            handlerName: key,
          })
        }

        // 2. Collect method middlewares
        const methodMiddlewares = fn[METHOD_MIDDLEWARES]
        if (methodMiddlewares) {
          proto[MIDDLEWARE_REGISTRY][key] =
            proto[MIDDLEWARE_REGISTRY][key] || []
          proto[MIDDLEWARE_REGISTRY][key].push(...methodMiddlewares)
        }

        // 3. Collect custom HttpCode / Header response metadata
        const classRouteMetadata = proto[ROUTE_METADATA_PROP] || {}
        const routeMetadata = fn[ROUTE_METADATA_PROP] || {}
        if (
          Object.keys(classRouteMetadata).length > 0 ||
          Object.keys(routeMetadata).length > 0
        ) {
          proto[ROUTE_METADATA][key] = {
            ...classRouteMetadata,
            ...routeMetadata,
          }
        }

        // 4. Collect Guards and Interceptors (merging class-level and method-level)
        const lifecycleMetadata = fn[LIFECYCLE_METADATA_PROP] || {}
        proto[LIFECYCLE_METADATA][key] = {
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

        // 5. Collect parameter injection metadata
        const paramMetadata = fn[PARAM_METADATA_PROP]
        if (paramMetadata) {
          proto[PARAM_METADATA][key] = paramMetadata
        }
      }
    }
  }
}

export function Injectable(options?: { scope?: 'singleton' | 'request' }): any {
  return function (target: any, _context?: ClassDecoratorContext) {
    if (options?.scope) {
      target.prototype[Symbol.for('exisjs:scope')] = options.scope
    }
  }
}

/**
 * Marks a class as a root Server module.
 */
export function Server(options?: ServerConfig): any {
  return function (target: any, _context?: ClassDecoratorContext) {
    target.prototype[SERVER_CONFIG] = options || {}
  }
}

/**
 * Marks a class as a Gateway module.
 */
export function Gateway(options?: GatewayConfig): any {
  return function (target: any, _context?: ClassDecoratorContext) {
    target.prototype[GATEWAY_CONFIG] = options || {}
  }
}
