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
  BOUNDARY_CONFIG,
  MODULE_METADATA,
} from './constants'
import type {
  ControllerOptions,
  ServerConfig,
  BoundaryConfig,
  ClassModuleOptions,
} from './constants'
import { MetadataEngine } from './core/metadata'

/**
 * Marks a class as a controller, automatically grouping its routes under the provided prefix.
 *
 * @param prefixOrOptions Base route prefix string or configuration options
 *
 * @example
 * ```ts
 * @Controller('/api/users')
 * export class UserController {
 *   @Get('/')
 *   getUsers() {
 *     return []
 *   }
 * }
 * ```
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

export const INJECTABLE_REGISTRY = new Set<any>()

/**
 * Decorates a class as a Dependency Injection provider managed by the Exis container.
 *
 * @param options Scope options (`singleton`, `request`, `transient`)
 *
 * @example
 * ```ts
 * @Injectable()
 * export class UserService {
 *   constructor(@Inject(DatabaseService) private db: DatabaseService) {}
 *
 *   async findById(id: string) {
 *     return this.db.query('SELECT * FROM users WHERE id = $1', [id])
 *   }
 * }
 * ```
 */
export function Injectable(options?: {
  scope?: 'singleton' | 'request' | 'transient'
}): any {
  return function (target: any, _context?: ClassDecoratorContext) {
    INJECTABLE_REGISTRY.add(target)
    if (options?.scope) {
      MetadataEngine.set(
        target.prototype,
        Symbol.for('exisjs:scope'),
        options.scope
      )
    }

    const proto = target.prototype
    if (proto) {
      const CRON_REGISTRY = Symbol.for('exisjs:cron_jobs')
      const CRON_META = Symbol.for('exisjs:cron_meta')
      MetadataEngine.init(proto, CRON_REGISTRY, [])
      const cronRegistry = MetadataEngine.get(proto, CRON_REGISTRY)

      for (const key of Object.getOwnPropertyNames(proto)) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, key)
        if (descriptor && typeof descriptor.value === 'function') {
          const fn = descriptor.value
          const cronMeta = MetadataEngine.get(fn, CRON_META)
          if (cronMeta) {
            const exists = cronRegistry.some((c: any) => c.methodName === key)
            if (!exists) {
              cronRegistry.push({ ...cronMeta, methodName: key })
            }
          }
        }
      }
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
 * Marks a class as a Boundary module (folder-scoped config + request pipeline).
 */
export function Boundary(options?: BoundaryConfig): any {
  return function (target: any, _context?: ClassDecoratorContext) {
    MetadataEngine.set(target.prototype, BOUNDARY_CONFIG, options || {})
  }
}

/**
 * Marks a class as an OOP Module, configuring its imported modules, controllers, providers, and exports.
 *
 * @example
 * ```ts
 * @Module({
 *   imports: [DatabaseModule],
 *   controllers: [UserController],
 *   providers: [UserService],
 * })
 * export class UserModule {}
 * ```
 */
export function Module(options: ClassModuleOptions = {}): any {
  return function (target: any, _context?: ClassDecoratorContext) {
    MetadataEngine.set(target, MODULE_METADATA, options)
    if (target.prototype) {
      MetadataEngine.set(target.prototype, MODULE_METADATA, options)
    }
  }
}
