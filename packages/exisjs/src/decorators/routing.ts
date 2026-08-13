import type { HttpMethod, RouteSchema } from '../types'
import { ROUTE_REGISTRY, ROUTE_META } from './constants'

export function createMethodDecorator(method: HttpMethod) {
  return function (path = '', schema?: RouteSchema<any, any, any, any>): any {
    if (method === 'GET' && schema?.body) {
      console.warn(
        `\x1b[33m[ExisJS] Warning: GET route '${path}' defines a body schema, but GET requests cannot have bodies.\x1b[0m`
      )
    }

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

/**
 * Marks a method as a GET route handler.
 *
 * Example:
 *
 *     @Get('/:id')
 *     getUser(@Param('id') id: string) { return { id }; }
 *
 * @param {string} [path] The route path
 * @param {RouteSchema} [schema] Optional validation schema
 * @public
 */
export const Get = createMethodDecorator('GET')

/**
 * Marks a method as a POST route handler.
 *
 * Example:
 *
 *     @Post('/', { body: v.object({ name: v.string() }) })
 *     createUser(@Body() body: any) { return body; }
 *
 * @param {string} [path] The route path
 * @param {RouteSchema} [schema] Optional validation schema
 * @public
 */
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
