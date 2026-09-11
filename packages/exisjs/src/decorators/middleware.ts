import {
  MIDDLEWARE_REGISTRY,
  METHOD_MIDDLEWARES,
  LIFECYCLE_METADATA_PROP,
} from './constants'
import { MetadataEngine } from './core/metadata'

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
 * @deprecated Use `@Use(...guards)` instead.
 */
export function UseGuards(...guards: any[]): any {
  return Use(...guards)
}

/**
 * @deprecated Use `@Use(...interceptors)` instead.
 */
export function UseInterceptors(...interceptors: any[]): any {
  return Use(...interceptors)
}

/**
 * @deprecated Use `@Use(...filters)` instead.
 */
export function UseFilters(...filters: any[]): any {
  return Use(...filters)
}

/**
 * Idempotency Decorator.
 * Caches responses based on the provided Idempotency-Key header.
 *
 * Example:
 *     @Post('/checkout')
 *     @Idempotent()
 *     checkout() {}
 */
export function Idempotent(
  options: import('../middleware/idempotency').IdempotentOptions = {}
): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    const isStandard =
      typeof contextOrPropertyKey === 'object' && contextOrPropertyKey !== null
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

    // Defer import to avoid circular dependencies
    const middlewareProxy = async (req: any, res: any, next: any) => {
      const { Idempotent: IdempotentMiddleware } =
        await import('../middleware/idempotency')
      const handler = IdempotentMiddleware(options)
      return handler(req, res, next)
    }

    methodMiddlewares.push(middlewareProxy)
  }
}

/**
 * Route-Level Timeout Decorator.
 * Configures an explicit timeout override for a long-running endpoint.
 *
 * Example:
 *     @Post('/heavy-task')
 *     @Timeout(120000)
 *     heavyTask() {}
 */
export function Timeout(
  msOrOptions: number | import('../middleware/security').TimeoutOptions
): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    const isStandard =
      typeof contextOrPropertyKey === 'object' && contextOrPropertyKey !== null
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

    const middlewareProxy = async (req: any, res: any, next: any) => {
      const { routeTimeout } = await import('../middleware/security')
      const handler = routeTimeout(msOrOptions)
      return handler(req, res, next)
    }

    methodMiddlewares.unshift(middlewareProxy)
  }
}
