import type { HttpMethod, RouteSchema, RouteValidator } from '../types'
import { ROUTE_REGISTRY, ROUTE_META } from './constants'
import { MetadataEngine } from './core/metadata'
import { logger } from '../logger'

export type MethodSchemaInput<
  TBody = any,
  TQuery = any,
  TParams = any,
  THeaders = any,
> =
  | RouteSchema<TBody, TQuery, TParams, THeaders>
  | RouteValidator<any>
  | { parse: (val: any) => any }
  | { _parse?: any }
  | { _def?: any }
  | { transform: (val: any, meta?: any) => any }
  | Record<string, any>

export function normalizeRouteSchema(
  method: HttpMethod,
  path: string,
  rawSchema?: MethodSchemaInput
): RouteSchema<any, any, any, any> | undefined {
  if (!rawSchema) return undefined

  // Check if it's already an explicit RouteSchema wrapper object (and not a direct TexEngine / Zod schema)
  if (
    typeof rawSchema === 'object' &&
    rawSchema !== null &&
    !('parse' in rawSchema) &&
    !('_parse' in rawSchema) &&
    !('__isTex' in rawSchema) &&
    ('body' in rawSchema ||
      'query' in rawSchema ||
      'params' in rawSchema ||
      'headers' in rawSchema ||
      'response' in rawSchema ||
      'responses' in rawSchema ||
      'timeout' in rawSchema ||
      'timeoutMs' in rawSchema ||
      'upload' in rawSchema ||
      'cors' in rawSchema ||
      'filters' in rawSchema ||
      'summary' in rawSchema ||
      'description' in rawSchema ||
      'tags' in rawSchema)
  ) {
    return rawSchema as RouteSchema<any, any, any, any>
  }

  // If rawSchema is a direct validator (TexEngine, Zod, object/function with parse/transform):
  if (
    (typeof rawSchema === 'object' && rawSchema !== null) ||
    typeof rawSchema === 'function'
  ) {
    if (['GET', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) {
      if (path.includes(':') || path.includes('*')) {
        return { params: rawSchema as any }
      }
      return { query: rawSchema as any }
    }
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      return { body: rawSchema as any }
    }
    if (path.includes(':') || path.includes('*')) {
      return { params: rawSchema as any }
    }
    return { query: rawSchema as any }
  }

  return rawSchema as RouteSchema<any, any, any, any>
}

export function createMethodDecorator(method: HttpMethod) {
  return function (path = '', schema?: MethodSchemaInput): any {
    const normalizedSchema = normalizeRouteSchema(method, path, schema)

    if (method === 'GET' && normalizedSchema?.body) {
      logger.warn(
        `GET route '${path}' defines a body schema, but GET requests cannot have bodies.`
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
        MetadataEngine.set(target, ROUTE_META, {
          method,
          path,
          schema: normalizedSchema,
        })
      } else {
        // Legacy/Experimental Decorator fallback
        const proto = typeof target === 'function' ? target.prototype : target
        const name = contextOrPropertyKey || descriptor?.name
        MetadataEngine.push(proto, ROUTE_REGISTRY, {
          method,
          path,
          schema: normalizedSchema,
          handlerName: name,
        })
      }
    }
  }
}

/**
 * Marks a controller method as an HTTP GET route handler.
 *
 * @param path Optional route path relative to controller prefix
 * @param schema Optional validation schema
 *
 * @example
 * ```ts
 * @Controller('/users')
 * export class UserController {
 *   @Get('/:id')
 *   getUser(@Param('id') id: string) {
 *     return { id }
 *   }
 * }
 * ```
 */
export const Get = createMethodDecorator('GET')

/**
 * Marks a controller method as an HTTP POST route handler.
 *
 * @param path Optional route path relative to controller prefix
 * @param schema Optional validation schema
 *
 * @example
 * ```ts
 * @Controller('/users')
 * export class UserController {
 *   @Post('/')
 *   createUser(@Body() body: CreateUserDto) {
 *     return { created: body.name }
 *   }
 * }
 * ```
 */
export const Post = createMethodDecorator('POST')

/**
 * Marks a controller method as an HTTP PUT route handler.
 *
 * @param path Optional route path relative to controller prefix
 * @param schema Optional validation schema
 *
 * @example
 * ```ts
 * @Controller('/users')
 * export class UserController {
 *   @Put('/:id')
 *   updateUser(@Param('id') id: string, @Body() body: UpdateUserDto) {
 *     return { updated: id }
 *   }
 * }
 * ```
 */
export const Put = createMethodDecorator('PUT')

/**
 * Marks a controller method as an HTTP PATCH route handler.
 *
 * @param path Optional route path relative to controller prefix
 * @param schema Optional validation schema
 */
export const Patch = createMethodDecorator('PATCH')

/**
 * Marks a controller method as an HTTP DELETE route handler.
 *
 * @param path Optional route path relative to controller prefix
 * @param schema Optional validation schema
 *
 * @example
 * ```ts
 * @Controller('/users')
 * export class UserController {
 *   @Delete('/:id')
 *   deleteUser(@Param('id') id: string) {
 *     return { deleted: true }
 *   }
 * }
 * ```
 */
export const Delete = createMethodDecorator('DELETE')

/**
 * Marks a controller method as an HTTP OPTIONS route handler.
 */
export const Options = createMethodDecorator('OPTIONS')

/**
 * Marks a controller method as an HTTP HEAD route handler.
 */
export const Head = createMethodDecorator('HEAD')

/**
 * Marks a controller method to handle any HTTP method (GET, POST, PUT, DELETE, PATCH, etc.).
 */
export const All = createMethodDecorator('ALL')

/**
 * Marks a controller method as an HTTP CONNECT route handler.
 */
export const Connect = createMethodDecorator('CONNECT')

/**
 * Marks a controller method as an HTTP TRACE route handler.
 */
export const Trace = createMethodDecorator('TRACE')
