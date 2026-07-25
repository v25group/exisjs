import type { HttpMethod, RouteSchema } from '../types'

// Store metadata on class prototypes using symbols to avoid reflect-metadata
export const ROUTE_REGISTRY = Symbol.for('exisjs:routes')
export const CONTROLLER_PREFIX = Symbol.for('exisjs:controller_prefix')
export const CONTROLLER_HOST = Symbol.for('exisjs:controller_host')
export const MIDDLEWARE_REGISTRY = Symbol.for('exisjs:middlewares')
export const ROUTE_METADATA = Symbol.for('exisjs:route_metadata')
export const LIFECYCLE_METADATA = Symbol.for('exisjs:lifecycle_metadata')
export const PARAM_METADATA = Symbol.for('exisjs:param_metadata')

const ROUTE_META = Symbol.for('exisjs:route_meta')
const METHOD_MIDDLEWARES = Symbol.for('exisjs:method_middlewares')
const ROUTE_METADATA_PROP = Symbol.for('exisjs:route_metadata_prop')
const LIFECYCLE_METADATA_PROP = Symbol.for('exisjs:lifecycle_metadata_prop')
const PARAM_METADATA_PROP = Symbol.for('exisjs:param_metadata_prop')

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

/**
 * Marks a class as a controller, automatically grouping its routes under the provided prefix.
 * Uses standard ES decorators, completely avoiding reflect-metadata bloat.
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
        const routeMetadata = fn[ROUTE_METADATA_PROP]
        if (routeMetadata) {
          proto[ROUTE_METADATA][key] = routeMetadata
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

function createMethodDecorator(method: HttpMethod) {
  return function (path = '', schema?: RouteSchema<any, any, any, any>): any {
    return function (
      target: any,
      contextOrPropertyKey?: string | symbol | any,
      descriptor?: PropertyDescriptor | any
    ) {
      if (
        typeof contextOrPropertyKey === 'object' &&
        contextOrPropertyKey !== null &&
        'name' in contextOrPropertyKey
      ) {
        // TS 5.0 Standard Method Decorator
        ;(target as any)[ROUTE_META] = {
          method,
          path,
          schema,
        }
      } else {
        // Legacy/Experimental Decorator fallback
        const proto = typeof target === 'function' ? target.prototype : target
        const name = contextOrPropertyKey || descriptor?.name
        if (!proto[ROUTE_REGISTRY]) proto[ROUTE_REGISTRY] = []
        proto[ROUTE_REGISTRY].push({
          method,
          path,
          schema,
          handlerName: name,
        })
      }
    }
  }
}

export const Get = createMethodDecorator('GET')
export const Post = createMethodDecorator('POST')
export const Put = createMethodDecorator('PUT')
export const Patch = createMethodDecorator('PATCH')
export const Delete = createMethodDecorator('DELETE')
export const Options = createMethodDecorator('OPTIONS')
export const Head = createMethodDecorator('HEAD')
export const All = createMethodDecorator('ALL')
export const Connect = createMethodDecorator('CONNECT')
export const Trace = createMethodDecorator('TRACE')
export const Ws = createMethodDecorator('WS')
export const Sse = createMethodDecorator('SSE')

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
          context.metadata[MIDDLEWARE_REGISTRY] =
            context.metadata[MIDDLEWARE_REGISTRY] || []
          context.metadata[MIDDLEWARE_REGISTRY].push(...middlewares)
        }
        target.prototype[MIDDLEWARE_REGISTRY] =
          target.prototype[MIDDLEWARE_REGISTRY] || []
        target.prototype[MIDDLEWARE_REGISTRY].push(...middlewares)
      } else if (context.kind === 'method') {
        // TS 5.0 Standard Method Decorator
        ;(target as any)[METHOD_MIDDLEWARES] =
          (target as any)[METHOD_MIDDLEWARES] || []
        ;(target as any)[METHOD_MIDDLEWARES].push(...middlewares)
      }
    } else {
      if (typeof target === 'function' && !contextOrPropertyKey) {
        // Legacy class decorator
        target.prototype[MIDDLEWARE_REGISTRY] =
          target.prototype[MIDDLEWARE_REGISTRY] || []
        target.prototype[MIDDLEWARE_REGISTRY].push(...middlewares)
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

// ─── Custom HTTP Status / Header Response Decorators ────────────────────────

export function HttpCode(code: number): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    const isStandard =
      typeof contextOrPropertyKey === 'object' && contextOrPropertyKey !== null
    const fn = isStandard ? target : descriptor.value

    fn[ROUTE_METADATA_PROP] = fn[ROUTE_METADATA_PROP] || {}
    fn[ROUTE_METADATA_PROP].httpCode = code
  }
}

export function Header(name: string, value: string): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    const isStandard =
      typeof contextOrPropertyKey === 'object' && contextOrPropertyKey !== null
    const fn = isStandard ? target : descriptor.value

    fn[ROUTE_METADATA_PROP] = fn[ROUTE_METADATA_PROP] || {}
    fn[ROUTE_METADATA_PROP].headers = fn[ROUTE_METADATA_PROP].headers || {}
    fn[ROUTE_METADATA_PROP].headers[name] = value
  }
}

// ─── Guards / Interceptors ──────────────────────────────────────────────────

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
        target.prototype[LIFECYCLE_METADATA_PROP] = target.prototype[LIFECYCLE_METADATA_PROP] || {}
        target.prototype[LIFECYCLE_METADATA_PROP]._classFilters = target.prototype[LIFECYCLE_METADATA_PROP]._classFilters || []
        target.prototype[LIFECYCLE_METADATA_PROP]._classFilters.push(...filters)
      } else if (context.kind === 'method') {
        ;(target as any)[LIFECYCLE_METADATA_PROP] = (target as any)[LIFECYCLE_METADATA_PROP] || {}
        ;(target as any)[LIFECYCLE_METADATA_PROP].filters = (target as any)[LIFECYCLE_METADATA_PROP].filters || []
        ;(target as any)[LIFECYCLE_METADATA_PROP].filters.push(...filters)
      }
    } else {
      if (typeof target === 'function' && !contextOrPropertyKey) {
        // Legacy class decorator
        target.prototype[LIFECYCLE_METADATA_PROP] = target.prototype[LIFECYCLE_METADATA_PROP] || {}
        target.prototype[LIFECYCLE_METADATA_PROP]._classFilters = target.prototype[LIFECYCLE_METADATA_PROP]._classFilters || []
        target.prototype[LIFECYCLE_METADATA_PROP]._classFilters.push(...filters)
      } else {
        // Legacy method decorator
        const fn = target[contextOrPropertyKey]
        fn[LIFECYCLE_METADATA_PROP] = fn[LIFECYCLE_METADATA_PROP] || {}
        fn[LIFECYCLE_METADATA_PROP].filters = fn[LIFECYCLE_METADATA_PROP].filters || []
        fn[LIFECYCLE_METADATA_PROP].filters.push(...filters)
      }
    }
  }
}

// ─── Route Parameters ──────────────────────────────────────────────────────────

function createParamDecorator(type: string, nameOrPipe?: string | any, ...pipes: any[]) {
  return function (
    target: any,
    propertyKey: string | symbol,
    parameterIndex: number
  ) {
    const isPipe = typeof nameOrPipe === 'function' || (typeof nameOrPipe === 'object' && nameOrPipe !== null)
    const name = isPipe ? undefined : nameOrPipe
    const allPipes = isPipe ? [nameOrPipe, ...pipes] : pipes

    const fn = target[propertyKey]
    fn[PARAM_METADATA_PROP] = fn[PARAM_METADATA_PROP] || []
    fn[PARAM_METADATA_PROP][parameterIndex] = { type, name, pipes: allPipes }
  }
}

export const Param = (nameOrPipe?: string | any, ...pipes: any[]) => createParamDecorator('param', nameOrPipe, ...pipes)
export const Body = (nameOrPipe?: string | any, ...pipes: any[]) => createParamDecorator('body', nameOrPipe, ...pipes)
export const Headers = (nameOrPipe?: string | any, ...pipes: any[]) => createParamDecorator('header', nameOrPipe, ...pipes)
export const HostParam = (nameOrPipe?: string | any, ...pipes: any[]) => createParamDecorator('host', nameOrPipe, ...pipes)
export const Req = () => createParamDecorator('req')
export const Socket = () => createParamDecorator('socket')
export const Stream = () => createParamDecorator('stream')
export const Session = () => createParamDecorator('session')
export const Next = () => createParamDecorator('next')
export const Ip = () => createParamDecorator('ip')
export const UploadedFile = (nameOrPipe?: string | any, ...pipes: any[]) => createParamDecorator('uploadedFile', nameOrPipe, ...pipes)
export const UploadedFiles = (nameOrPipe?: string | any, ...pipes: any[]) => createParamDecorator('uploadedFiles', nameOrPipe, ...pipes)

export const Res = (options?: { passthrough?: boolean }): any => {
  return function (
    target: any,
    propertyKey: string | symbol,
    parameterIndex: number
  ) {
    const fn = target[propertyKey]
    fn[PARAM_METADATA_PROP] = fn[PARAM_METADATA_PROP] || []
    fn[PARAM_METADATA_PROP][parameterIndex] = { type: 'res' }

    fn[ROUTE_METADATA_PROP] = fn[ROUTE_METADATA_PROP] || {}
    fn[ROUTE_METADATA_PROP].manualRes = !options?.passthrough
  }
}

export function Query(
  pathOrName?: string | any,
  schemaOrPipe?: RouteSchema<any, any, any, any> | any,
  ...pipes: any[]
): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptorOrIndex?: any
  ) {
    const isParam =
      typeof descriptorOrIndex === 'number' ||
      (contextOrPropertyKey && contextOrPropertyKey.kind === 'parameter')

    if (isParam) {
      const isPipe = typeof pathOrName === 'function' || (typeof pathOrName === 'object' && pathOrName !== null)
      const name = isPipe ? undefined : pathOrName
      const pipesArray: any[] = isPipe ? [pathOrName] : []
      if (schemaOrPipe && (typeof schemaOrPipe === 'function' || typeof schemaOrPipe === 'object')) {
         pipesArray.push(schemaOrPipe)
      }
      pipesArray.push(...pipes)

      const parameterIndex = descriptorOrIndex
      const fn = target[contextOrPropertyKey]
      fn[PARAM_METADATA_PROP] = fn[PARAM_METADATA_PROP] || []
      fn[PARAM_METADATA_PROP][parameterIndex] = {
        type: 'query',
        name,
        pipes: pipesArray
      }
    } else {
      const path = pathOrName || ''
      if (
        typeof contextOrPropertyKey === 'object' &&
        contextOrPropertyKey !== null &&
        'name' in contextOrPropertyKey
      ) {
        ;(target as any)[ROUTE_META] = {
          method: 'QUERY',
          path,
          schema: schemaOrPipe,
        }
      } else {
        const proto = typeof target === 'function' ? target.prototype : target
        const name = contextOrPropertyKey || descriptorOrIndex?.name
        if (!proto[ROUTE_REGISTRY]) proto[ROUTE_REGISTRY] = []
        proto[ROUTE_REGISTRY].push({
          method: 'QUERY',
          path,
          schema: schemaOrPipe,
          handlerName: name,
        })
      }
    }
  }
}

export const Redirect = (url: string, statusCode = 302): any => {
  return function (target: any, propertyKey: string | symbol) {
    const fn = target[propertyKey]
    fn[ROUTE_METADATA_PROP] = fn[ROUTE_METADATA_PROP] || {}
    fn[ROUTE_METADATA_PROP].redirect = { url, statusCode }
  }
}

export const Hosts = (...hosts: string[]): any => {
  return function (target: any, propertyKey?: string | symbol) {
    if (propertyKey) {
      const fn = target[propertyKey]
      fn[ROUTE_METADATA_PROP] = fn[ROUTE_METADATA_PROP] || {}
      fn[ROUTE_METADATA_PROP].hosts = hosts
    } else {
      target.prototype[CONTROLLER_HOST] = hosts
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
