import {
  MIDDLEWARE_REGISTRY,
  METHOD_MIDDLEWARES,
  LIFECYCLE_METADATA_PROP,
} from './constants'
import { MetadataEngine } from './core/metadata'
import { rateLimit } from '../middleware/rate-limit'
import { cors } from '../middleware/middleware'
import { routeTimeout } from '../middleware/security'
import { ipFilter } from '../middleware/ip-filter'
import { compression } from '../middleware/compression'
import { dedupeMiddleware } from '../middleware/dedupe'
import { idempotent as IdempotentMiddleware } from '../middleware/idempotency'
import {
  blockSuspiciousProbes,
  type BlockProbesOptions,
} from '../middleware/security'

/**
 * Classifies a handler item into middleware, guard, interceptor, or filter.
 */
function classifyItem(
  item: any
): 'guard' | 'interceptor' | 'filter' | 'middleware' {
  if (!item) return 'middleware'

  // Class instances or class prototypes
  const proto = typeof item === 'function' ? item.prototype : item

  if (proto) {
    if (typeof proto.canActivate === 'function') return 'guard'
    if (typeof proto.intercept === 'function') return 'interceptor'
    if (typeof proto.catch === 'function') return 'filter'
  }

  // Functional duck-typing checks
  if (typeof item === 'object') {
    if (typeof item.canActivate === 'function') return 'guard'
    if (typeof item.intercept === 'function') return 'interceptor'
    if (typeof item.catch === 'function') return 'filter'
  }

  return 'middleware'
}

/**
 * Applies middleware, guards, interceptors, or exception filters to a Controller class or route method.
 * Unifies @Use, @UseGuards, @UseInterceptors, and @UseFilters into a single, cohesive decorator.
 *
 * Example:
 *     @Use(requireAuth)
 *     @Use(AdminGuard)
 *     @Get('/dashboard')
 *     getDashboard() {}
 *
 * @param {...any} items Middleware functions, Guards, Interceptors, or Filters
 * @public
 */
export function Use(...items: any[]): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    const isStandard =
      typeof contextOrPropertyKey === 'object' && contextOrPropertyKey !== null

    const kind = isStandard ? contextOrPropertyKey.kind : undefined

    if (
      kind === 'class' ||
      (!isStandard && typeof target === 'function' && !contextOrPropertyKey)
    ) {
      // Class-level decorator
      const proto = target.prototype || target
      const classLifecycle = MetadataEngine.init<any>(
        proto,
        LIFECYCLE_METADATA_PROP,
        {}
      )
      classLifecycle._classGuards = classLifecycle._classGuards || []
      classLifecycle._classInterceptors =
        classLifecycle._classInterceptors || []
      classLifecycle._classFilters = classLifecycle._classFilters || []

      const classMiddlewares = MetadataEngine.init<any>(
        proto,
        MIDDLEWARE_REGISTRY,
        {
          _classMiddlewares: [],
        }
      )
      if (!classMiddlewares._classMiddlewares) {
        classMiddlewares._classMiddlewares = []
      }

      for (const item of items) {
        const type = classifyItem(item)
        if (type === 'guard') {
          classLifecycle._classGuards.push(item)
        } else if (type === 'interceptor') {
          classLifecycle._classInterceptors.push(item)
        } else if (type === 'filter') {
          classLifecycle._classFilters.push(item)
        } else {
          classMiddlewares._classMiddlewares.push(item)
        }
      }
    } else {
      // Method-level decorator
      const fn = isStandard
        ? target
        : descriptor
          ? descriptor.value
          : target[contextOrPropertyKey]
      const methodLifecycle = MetadataEngine.init<any>(
        fn,
        LIFECYCLE_METADATA_PROP,
        {}
      )
      methodLifecycle.guards = methodLifecycle.guards || []
      methodLifecycle.interceptors = methodLifecycle.interceptors || []
      methodLifecycle.filters = methodLifecycle.filters || []

      const methodMiddlewares = MetadataEngine.init<any[]>(
        fn,
        METHOD_MIDDLEWARES,
        []
      )

      for (const item of items) {
        const type = classifyItem(item)
        if (type === 'guard') {
          methodLifecycle.guards.push(item)
        } else if (type === 'interceptor') {
          methodLifecycle.interceptors.push(item)
        } else if (type === 'filter') {
          methodLifecycle.filters.push(item)
        } else {
          methodMiddlewares.push(item)
        }
      }
    }
  }
}

/**
 * Applies guards to a Controller class or route method.
 *
 * @example
 * ```ts
 * @Controller('/admin')
 * @UseGuards(AuthGuard, RoleGuard)
 * export class AdminController {}
 * ```
 */
export function UseGuards(...guards: any[]): any {
  return Use(...guards)
}

/**
 * Applies interceptors to a Controller class or route method.
 *
 * @example
 * ```ts
 * @Controller('/users')
 * @UseInterceptors(LoggingInterceptor)
 * export class UsersController {}
 * ```
 */
export function UseInterceptors(...interceptors: any[]): any {
  return Use(...interceptors)
}

/**
 * Applies exception filters to a Controller class or route method.
 *
 * @example
 * ```ts
 * @Controller('/items')
 * @UseFilters(HttpExceptionFilter)
 * export class ItemsController {}
 * ```
 */
export function UseFilters(...filters: any[]): any {
  return Use(...filters)
}

/**
 * Helper to apply a middleware factory at either class or method level.
 */
function applyMiddlewareDecorator(
  target: any,
  contextOrPropertyKey: string | symbol | any,
  descriptor: PropertyDescriptor | any,
  middlewareFactory: (req: any, res: any, next: any) => any,
  unshift = false
) {
  const isStandard =
    typeof contextOrPropertyKey === 'object' && contextOrPropertyKey !== null
  const kind = isStandard ? contextOrPropertyKey.kind : undefined

  if (
    kind === 'class' ||
    (!isStandard && typeof target === 'function' && !contextOrPropertyKey)
  ) {
    const proto = target.prototype || target
    const classMiddlewares = MetadataEngine.init<any>(
      proto,
      MIDDLEWARE_REGISTRY,
      { _classMiddlewares: [] }
    )
    if (!classMiddlewares._classMiddlewares) {
      classMiddlewares._classMiddlewares = []
    }
    if (unshift) {
      classMiddlewares._classMiddlewares.unshift(middlewareFactory)
    } else {
      classMiddlewares._classMiddlewares.push(middlewareFactory)
    }
  } else {
    const fn = isStandard
      ? target
      : descriptor
        ? descriptor.value
        : target[contextOrPropertyKey]
    const methodMiddlewares = MetadataEngine.init<any[]>(
      fn,
      METHOD_MIDDLEWARES,
      []
    )
    if (unshift) {
      methodMiddlewares.unshift(middlewareFactory)
    } else {
      methodMiddlewares.push(middlewareFactory)
    }
  }
}

/**
 * Idempotency Decorator.
 * Caches responses based on the provided Idempotency-Key header.
 * Works on both Controller classes and individual route methods.
 *
 * Example:
 *     @Post('/checkout')
 *     @Idempotent()
 *     checkout() {}
 */
export function Idempotent(
  options: import('../middleware/idempotency').IdempotentOptions = {}
): any {
  const handler = IdempotentMiddleware(options)
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    applyMiddlewareDecorator(target, contextOrPropertyKey, descriptor, handler)
  }
}

/**
 * Route-Level / Controller-Level Timeout Decorator.
 * Configures an explicit timeout override for a route method or entire controller.
 *
 * Example:
 *     @Post('/heavy-task')
 *     @Timeout(120000)
 *     heavyTask() {}
 */
export function Timeout(
  msOrOptions: number | import('../middleware/security').TimeoutOptions
): any {
  const handler = routeTimeout(msOrOptions)
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    applyMiddlewareDecorator(
      target,
      contextOrPropertyKey,
      descriptor,
      handler,
      true
    )
  }
}

/**
 * Rate Limiting Decorator.
 * Enforces request rate limits on a Controller class or route method.
 *
 * Example:
 *     @Get('/sensitive-data')
 *     @RateLimit({ max: 10, windowMs: 60000 })
 *     getSensitiveData() {}
 */
export function RateLimit(
  options: import('../middleware/rate-limit').RateLimitOptions = {}
): any {
  const handler = rateLimit(options)
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    applyMiddlewareDecorator(target, contextOrPropertyKey, descriptor, handler)
  }
}

/**
 * CORS Decorator.
 * Configures Cross-Origin Resource Sharing on a Controller class or route method.
 *
 * Example:
 *     @Get('/public-api')
 *     @Cors({ origin: '*' })
 *     getPublicData() {}
 */
export function Cors(options: import('../types').CorsConfig = {}): any {
  const handler = cors(options)
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    applyMiddlewareDecorator(
      target,
      contextOrPropertyKey,
      descriptor,
      handler,
      true
    )
  }
}

/**
 * IP Filter Decorator.
 * Enforces IP/CIDR allowlist and denylist on a Controller class or route method.
 *
 * Example:
 *     @Controller('/admin')
 *     @IpFilter({ allow: ['127.0.0.1', '10.0.0.0/8'] })
 *     export class AdminController {}
 */
export function IpFilter(
  options: import('../middleware/ip-filter').IpFilterOptions
): any {
  const handler = ipFilter(options)
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    applyMiddlewareDecorator(target, contextOrPropertyKey, descriptor, handler)
  }
}

/**
 * Compression Decorator.
 * Enables automatic gzip/brotli response compression on a Controller class or route method.
 *
 * Example:
 *     @Get('/large-dataset')
 *     @Compress()
 *     getDataset() {}
 */
export function Compress(): any {
  const handler = compression()
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    applyMiddlewareDecorator(target, contextOrPropertyKey, descriptor, handler)
  }
}

/**
 * Request Deduplication Decorator.
 * Prevents duplicate parallel requests sharing the same key.
 *
 * Example:
 *     @Post('/order/charge')
 *     @Dedupe({ keyGenerator: (req) => req.user?.id || req.ip })
 *     chargeOrder() {}
 */
export function Dedupe(
  options: import('../middleware/dedupe').DedupeOptions
): any {
  const handler = dedupeMiddleware(options)
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    applyMiddlewareDecorator(target, contextOrPropertyKey, descriptor, handler)
  }
}

/**
 * Security Scanner Noise Suppression & Blackhole Decorator.
 * Intercepts exploit probes (`.env`, `/.git`, `/.DS_Store`) and blackholes them.
 *
 * Example:
 *     @Controller('/api')
 *     @BlockProbes({ statusCode: 404, silent: true })
 *     export default class ApiController {}
 */
export function BlockProbes(options?: BlockProbesOptions): any {
  const handler = blockSuspiciousProbes(options)
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    applyMiddlewareDecorator(target, contextOrPropertyKey, descriptor, handler)
  }
}

export const BlockSuspiciousProbes = BlockProbes
