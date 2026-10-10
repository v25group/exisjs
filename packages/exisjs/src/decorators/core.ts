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

    // Collect prototype inheritance chain (base classes first, derived class last)
    const protoChain: any[] = []
    let currProto = proto
    while (currProto && currProto !== Object.prototype) {
      protoChain.unshift(currProto)
      currProto = Object.getPrototypeOf(currProto)
    }

    // Accumulate class-level middlewares across the inheritance hierarchy
    const combinedClassMiddlewares: any[] = []
    const combinedClassGuards: any[] = []
    const combinedClassInterceptors: any[] = []
    const combinedClassFilters: any[] = []
    let combinedClassRouteMetadata: Record<string, any> = {}

    for (const p of protoChain) {
      const middlewares = MetadataEngine.get(p, MIDDLEWARE_REGISTRY)
      if (Array.isArray(middlewares)) {
        combinedClassMiddlewares.push(...middlewares)
      } else if (middlewares?._classMiddlewares) {
        combinedClassMiddlewares.push(...middlewares._classMiddlewares)
      }

      const lifecycle = MetadataEngine.get(p, LIFECYCLE_METADATA_PROP) || {}
      if (lifecycle._classGuards)
        combinedClassGuards.push(...lifecycle._classGuards)
      if (lifecycle._classInterceptors)
        combinedClassInterceptors.push(...lifecycle._classInterceptors)
      if (lifecycle._classFilters)
        combinedClassFilters.push(...lifecycle._classFilters)

      const classRouteMeta = MetadataEngine.get(p, ROUTE_METADATA_PROP) || {}
      combinedClassRouteMetadata = {
        ...combinedClassRouteMetadata,
        ...classRouteMeta,
      }
    }

    MetadataEngine.set(proto, MIDDLEWARE_REGISTRY, {
      _classMiddlewares: combinedClassMiddlewares,
    })

    MetadataEngine.init(proto, ROUTE_METADATA, {})
    MetadataEngine.init(proto, LIFECYCLE_METADATA, {})
    MetadataEngine.init(proto, PARAM_METADATA, {})

    const routeRegistry = MetadataEngine.get(proto, ROUTE_REGISTRY)
    const middlewareRegistry = MetadataEngine.get(proto, MIDDLEWARE_REGISTRY)
    const routeMetadataMap = MetadataEngine.get(proto, ROUTE_METADATA)
    const lifecycleMetadataMap = MetadataEngine.get(proto, LIFECYCLE_METADATA)
    const paramMetadataMap = MetadataEngine.get(proto, PARAM_METADATA)

    // Gather all unique property names across prototype chain
    const allKeys = new Set<string>()
    for (const p of protoChain) {
      for (const key of Object.getOwnPropertyNames(p)) {
        if (key !== 'constructor') {
          allKeys.add(key)
        }
      }
    }

    for (const key of allKeys) {
      // Find the most derived implementation in the prototype chain
      let targetFn: any = undefined
      for (let i = protoChain.length - 1; i >= 0; i--) {
        const desc = Object.getOwnPropertyDescriptor(protoChain[i], key)
        if (desc && typeof desc.value === 'function') {
          targetFn = desc.value
          break
        }
      }

      if (typeof targetFn === 'function') {
        // Inspect ROUTE_META (check most derived first, then base classes)
        let routeMeta: any = undefined
        for (let i = protoChain.length - 1; i >= 0; i--) {
          const fn = protoChain[i][key]
          if (typeof fn === 'function') {
            const meta = MetadataEngine.get(fn, ROUTE_META)
            if (meta) {
              routeMeta = meta
              break
            }
          }
        }

        if (routeMeta) {
          const existingIdx = routeRegistry.findIndex(
            (r: any) => r.handlerName === key
          )
          if (existingIdx !== -1) {
            routeRegistry[existingIdx] = { ...routeMeta, handlerName: key }
          } else {
            routeRegistry.push({ ...routeMeta, handlerName: key })
          }
        }

        // Method middlewares inheritance
        const methodMiddlewares: any[] = []
        for (const p of protoChain) {
          const fn = p[key]
          if (typeof fn === 'function') {
            const mm = MetadataEngine.get(fn, METHOD_MIDDLEWARES)
            if (mm) methodMiddlewares.push(...mm)
          }
        }
        if (methodMiddlewares.length > 0) {
          middlewareRegistry[key] = methodMiddlewares
        }

        // Route metadata inheritance
        let methodRouteMetadata: Record<string, any> = {}
        for (const p of protoChain) {
          const fn = p[key]
          if (typeof fn === 'function') {
            const rm = MetadataEngine.get(fn, ROUTE_METADATA_PROP)
            if (rm) methodRouteMetadata = { ...methodRouteMetadata, ...rm }
          }
        }
        if (
          Object.keys(combinedClassRouteMetadata).length > 0 ||
          Object.keys(methodRouteMetadata).length > 0
        ) {
          routeMetadataMap[key] = {
            ...combinedClassRouteMetadata,
            ...methodRouteMetadata,
          }
        }

        // Lifecycle metadata inheritance (guards, interceptors, filters)
        const methodGuards: any[] = []
        const methodInterceptors: any[] = []
        const methodFilters: any[] = []
        for (const p of protoChain) {
          const fn = p[key]
          if (typeof fn === 'function') {
            const lm = MetadataEngine.get(fn, LIFECYCLE_METADATA_PROP)
            if (lm?.guards) methodGuards.push(...lm.guards)
            if (lm?.interceptors) methodInterceptors.push(...lm.interceptors)
            if (lm?.filters) methodFilters.push(...lm.filters)
          }
        }
        lifecycleMetadataMap[key] = {
          guards: [...combinedClassGuards, ...methodGuards],
          interceptors: [...combinedClassInterceptors, ...methodInterceptors],
          filters: [...combinedClassFilters, ...methodFilters],
        }

        // Parameter metadata inheritance
        let paramMetadata: any = undefined
        for (let i = protoChain.length - 1; i >= 0; i--) {
          const fn = protoChain[i][key]
          if (typeof fn === 'function') {
            const pm = MetadataEngine.get(fn, PARAM_METADATA_PROP)
            if (pm) {
              paramMetadata = pm
              break
            }
          }
        }
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
    // Lets the DI container recognise classes it is responsible for building
    Object.defineProperty(target, Symbol.for('exisjs:injectable'), {
      value: true,
      enumerable: false,
    })
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

/**
 * Marks a module as global, making its providers available everywhere without re-importing the module.
 *
 * @example
 * ```ts
 * @Global()
 * @Module({
 *   providers: [SharedService],
 *   exports: [SharedService],
 * })
 * export class SharedModule {}
 * ```
 */
export function Global(): any {
  return function (target: any, _context?: ClassDecoratorContext) {
    const GLOBAL_METADATA = Symbol.for('exisjs:global')
    MetadataEngine.set(target, GLOBAL_METADATA, true)
    if (target.prototype) {
      MetadataEngine.set(target.prototype, GLOBAL_METADATA, true)
    }
  }
}
