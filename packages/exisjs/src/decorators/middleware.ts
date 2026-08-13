import {
  MIDDLEWARE_REGISTRY,
  METHOD_MIDDLEWARES,
  LIFECYCLE_METADATA_PROP,
} from './constants'

/**
 * Applies middleware to a Controller class or route method.
 *
 * Example:
 *
 *     @Use(requireAuth)
 *     @Get('/dashboard')
 *     getDashboard() {}
 *
 * @param {...any} middlewares Middleware functions
 * @public
 */
export function Use(...middlewares: any[]): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    _descriptor?: PropertyDescriptor | any
  ) {
    if (
      typeof contextOrPropertyKey === 'object' &&
      contextOrPropertyKey !== null
    ) {
      const context = contextOrPropertyKey
      if (context.kind === 'class') {
        if (context.metadata) {
          if (
            !context.metadata[MIDDLEWARE_REGISTRY] ||
            Array.isArray(context.metadata[MIDDLEWARE_REGISTRY])
          ) {
            context.metadata[MIDDLEWARE_REGISTRY] = {
              _classMiddlewares: context.metadata[MIDDLEWARE_REGISTRY] || [],
            }
          } else if (!context.metadata[MIDDLEWARE_REGISTRY]._classMiddlewares) {
            context.metadata[MIDDLEWARE_REGISTRY]._classMiddlewares = []
          }
          context.metadata[MIDDLEWARE_REGISTRY]._classMiddlewares.push(
            ...middlewares
          )
        }

        if (
          !target.prototype[MIDDLEWARE_REGISTRY] ||
          Array.isArray(target.prototype[MIDDLEWARE_REGISTRY])
        ) {
          target.prototype[MIDDLEWARE_REGISTRY] = {
            _classMiddlewares: target.prototype[MIDDLEWARE_REGISTRY] || [],
          }
        } else if (!target.prototype[MIDDLEWARE_REGISTRY]._classMiddlewares) {
          target.prototype[MIDDLEWARE_REGISTRY]._classMiddlewares = []
        }
        target.prototype[MIDDLEWARE_REGISTRY]._classMiddlewares.push(
          ...middlewares
        )
      } else if (context.kind === 'method') {
        // TS 5.0 Standard Method Decorator
        ;(target as any)[METHOD_MIDDLEWARES] =
          (target as any)[METHOD_MIDDLEWARES] || []
        ;(target as any)[METHOD_MIDDLEWARES].push(...middlewares)
      }
    } else {
      if (typeof target === 'function' && !contextOrPropertyKey) {
        // Legacy class decorator
        const proto = target.prototype
        if (
          !proto[MIDDLEWARE_REGISTRY] ||
          Array.isArray(proto[MIDDLEWARE_REGISTRY])
        ) {
          proto[MIDDLEWARE_REGISTRY] = {
            _classMiddlewares: proto[MIDDLEWARE_REGISTRY] || [],
          }
        } else if (!proto[MIDDLEWARE_REGISTRY]._classMiddlewares) {
          proto[MIDDLEWARE_REGISTRY]._classMiddlewares = []
        }
        proto[MIDDLEWARE_REGISTRY]._classMiddlewares.push(...middlewares)
      } else {
        // Legacy method decorator
        const proto = target
        const name = contextOrPropertyKey
        if (!proto[MIDDLEWARE_REGISTRY]) proto[MIDDLEWARE_REGISTRY] = {}
        if (!proto[MIDDLEWARE_REGISTRY][name])
          proto[MIDDLEWARE_REGISTRY][name] = []
        proto[MIDDLEWARE_REGISTRY][name].push(...middlewares)
      }
    }
  }
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
    const fn = isStandard ? target : descriptor.value

    fn[METHOD_MIDDLEWARES] = fn[METHOD_MIDDLEWARES] || []

    // Defer import to avoid circular dependencies
    const middlewareProxy = async (req: any, res: any, next: any) => {
      const { Idempotent: IdempotentMiddleware } =
        await import('../middleware/idempotency')
      const handler = IdempotentMiddleware(options)
      return handler(req, res, next)
    }

    fn[METHOD_MIDDLEWARES].push(middlewareProxy)
  }
}

/**
 * Cache Decorator.
 * Caches responses for GET requests.
 *
 * Example:
 *     @Get('/popular')
 *     @Cache({ ttlMs: 60000 })
 *     getPopular() {}
 */
export function Cache(
  options: import('../middleware/cache').CacheOptions
): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    const isStandard =
      typeof contextOrPropertyKey === 'object' && contextOrPropertyKey !== null
    const fn = isStandard ? target : descriptor.value

    fn[METHOD_MIDDLEWARES] = fn[METHOD_MIDDLEWARES] || []

    const opts = options

    // Defer import to avoid circular dependencies
    const middlewareProxy = async (req: any, res: any, next: any) => {
      const { cacheMiddleware } = await import('../middleware/cache')
      const handler = cacheMiddleware(opts)
      return handler(req, res, next)
    }

    fn[METHOD_MIDDLEWARES].push(middlewareProxy)
  }
}

export function UseGuards(...guards: any[]): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    _descriptor?: PropertyDescriptor | any
  ) {
    if (
      typeof contextOrPropertyKey === 'object' &&
      contextOrPropertyKey !== null
    ) {
      const context = contextOrPropertyKey
      if (context.kind === 'class') {
        target.prototype[LIFECYCLE_METADATA_PROP] =
          target.prototype[LIFECYCLE_METADATA_PROP] || {}
        target.prototype[LIFECYCLE_METADATA_PROP]._classGuards =
          target.prototype[LIFECYCLE_METADATA_PROP]._classGuards || []
        target.prototype[LIFECYCLE_METADATA_PROP]._classGuards.push(...guards)
      } else if (context.kind === 'method') {
        ;(target as any)[LIFECYCLE_METADATA_PROP] =
          (target as any)[LIFECYCLE_METADATA_PROP] || {}
        ;(target as any)[LIFECYCLE_METADATA_PROP].guards =
          (target as any)[LIFECYCLE_METADATA_PROP].guards || []
        ;(target as any)[LIFECYCLE_METADATA_PROP].guards.push(...guards)
      }
    } else {
      if (typeof target === 'function' && !contextOrPropertyKey) {
        // Legacy class decorator
        target.prototype[LIFECYCLE_METADATA_PROP] =
          target.prototype[LIFECYCLE_METADATA_PROP] || {}
        target.prototype[LIFECYCLE_METADATA_PROP]._classGuards =
          target.prototype[LIFECYCLE_METADATA_PROP]._classGuards || []
        target.prototype[LIFECYCLE_METADATA_PROP]._classGuards.push(...guards)
      } else {
        // Legacy method decorator
        const fn = target[contextOrPropertyKey]
        fn[LIFECYCLE_METADATA_PROP] = fn[LIFECYCLE_METADATA_PROP] || {}
        fn[LIFECYCLE_METADATA_PROP].guards =
          fn[LIFECYCLE_METADATA_PROP].guards || []
        fn[LIFECYCLE_METADATA_PROP].guards.push(...guards)
      }
    }
  }
}

export function UseInterceptors(...interceptors: any[]): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    _descriptor?: PropertyDescriptor | any
  ) {
    if (
      typeof contextOrPropertyKey === 'object' &&
      contextOrPropertyKey !== null
    ) {
      const context = contextOrPropertyKey
      if (context.kind === 'class') {
        target.prototype[LIFECYCLE_METADATA_PROP] =
          target.prototype[LIFECYCLE_METADATA_PROP] || {}
        target.prototype[LIFECYCLE_METADATA_PROP]._classInterceptors =
          target.prototype[LIFECYCLE_METADATA_PROP]._classInterceptors || []
        target.prototype[LIFECYCLE_METADATA_PROP]._classInterceptors.push(
          ...interceptors
        )
      } else if (context.kind === 'method') {
        ;(target as any)[LIFECYCLE_METADATA_PROP] =
          (target as any)[LIFECYCLE_METADATA_PROP] || {}
        ;(target as any)[LIFECYCLE_METADATA_PROP].interceptors =
          (target as any)[LIFECYCLE_METADATA_PROP].interceptors || []
        ;(target as any)[LIFECYCLE_METADATA_PROP].interceptors.push(
          ...interceptors
        )
      }
    } else {
      if (typeof target === 'function' && !contextOrPropertyKey) {
        // Legacy class decorator
        target.prototype[LIFECYCLE_METADATA_PROP] =
          target.prototype[LIFECYCLE_METADATA_PROP] || {}
        target.prototype[LIFECYCLE_METADATA_PROP]._classInterceptors =
          target.prototype[LIFECYCLE_METADATA_PROP]._classInterceptors || []
        target.prototype[LIFECYCLE_METADATA_PROP]._classInterceptors.push(
          ...interceptors
        )
      } else {
        // Legacy method decorator
        const fn = target[contextOrPropertyKey]
        fn[LIFECYCLE_METADATA_PROP] = fn[LIFECYCLE_METADATA_PROP] || {}
        fn[LIFECYCLE_METADATA_PROP].interceptors =
          fn[LIFECYCLE_METADATA_PROP].interceptors || []
        fn[LIFECYCLE_METADATA_PROP].interceptors.push(...interceptors)
      }
    }
  }
}

export function UseFilters(...filters: any[]): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    _descriptor?: PropertyDescriptor | any
  ) {
    if (
      typeof contextOrPropertyKey === 'object' &&
      contextOrPropertyKey !== null
    ) {
      const context = contextOrPropertyKey
      if (context.kind === 'class') {
        target.prototype[LIFECYCLE_METADATA_PROP] =
          target.prototype[LIFECYCLE_METADATA_PROP] || {}
        target.prototype[LIFECYCLE_METADATA_PROP]._classFilters =
          target.prototype[LIFECYCLE_METADATA_PROP]._classFilters || []
        target.prototype[LIFECYCLE_METADATA_PROP]._classFilters.push(...filters)
      } else if (context.kind === 'method') {
        ;(target as any)[LIFECYCLE_METADATA_PROP] =
          (target as any)[LIFECYCLE_METADATA_PROP] || {}
        ;(target as any)[LIFECYCLE_METADATA_PROP].filters =
          (target as any)[LIFECYCLE_METADATA_PROP].filters || []
        ;(target as any)[LIFECYCLE_METADATA_PROP].filters.push(...filters)
      }
    } else {
      if (typeof target === 'function' && !contextOrPropertyKey) {
        // Legacy class decorator
        target.prototype[LIFECYCLE_METADATA_PROP] =
          target.prototype[LIFECYCLE_METADATA_PROP] || {}
        target.prototype[LIFECYCLE_METADATA_PROP]._classFilters =
          target.prototype[LIFECYCLE_METADATA_PROP]._classFilters || []
        target.prototype[LIFECYCLE_METADATA_PROP]._classFilters.push(...filters)
      } else {
        // Legacy method decorator
        const fn = target[contextOrPropertyKey]
        fn[LIFECYCLE_METADATA_PROP] = fn[LIFECYCLE_METADATA_PROP] || {}
        fn[LIFECYCLE_METADATA_PROP].filters =
          fn[LIFECYCLE_METADATA_PROP].filters || []
        fn[LIFECYCLE_METADATA_PROP].filters.push(...filters)
      }
    }
  }
}
