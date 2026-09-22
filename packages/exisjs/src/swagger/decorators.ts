import { ROUTE_METADATA_PROP } from '../decorators/constants'

export const OPENAPI_CLASS_META = Symbol.for('exisjs:openapi_class_meta')
export const OPENAPI_PROPERTY_META = Symbol.for('exisjs:openapi_property_meta')

/**
 * Assigns one or more OpenAPI tags to a class controller or method handler.
 *
 * @example
 * ```ts
 * @ApiTags('Users', 'Authentication')
 * @Controller('/users')
 * export class UserController {}
 * ```
 */
export function ApiTags(...tags: string[]): any {
  return function (
    target: any,
    propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor
  ) {
    if (propertyKey && descriptor) {
      const fn = descriptor.value
      fn[ROUTE_METADATA_PROP] = fn[ROUTE_METADATA_PROP] || {}
      fn[ROUTE_METADATA_PROP].tags = [
        ...(fn[ROUTE_METADATA_PROP].tags || []),
        ...tags,
      ]
    } else {
      target[OPENAPI_CLASS_META] = target[OPENAPI_CLASS_META] || {}
      target[OPENAPI_CLASS_META].tags = [
        ...(target[OPENAPI_CLASS_META].tags || []),
        ...tags,
      ]
    }
  }
}

export const Tags = ApiTags

/**
 * Attaches OpenAPI operation metadata (summary, description, operationId, deprecated status) to a route method.
 *
 * @example
 * ```ts
 * @Get('/:id')
 * @ApiOperation({ summary: 'Get User By ID', description: 'Fetches user details' })
 * getUser() {}
 * ```
 */
export function ApiOperation(options: {
  summary?: string
  description?: string
  operationId?: string
  deprecated?: boolean
  externalDocs?: { url: string; description?: string }
}): any {
  return function (
    _target: any,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ) {
    const fn = descriptor.value
    fn[ROUTE_METADATA_PROP] = fn[ROUTE_METADATA_PROP] || {}
    if (options.summary) fn[ROUTE_METADATA_PROP].summary = options.summary
    if (options.description)
      fn[ROUTE_METADATA_PROP].description = options.description
    if (options.operationId)
      fn[ROUTE_METADATA_PROP].operationId = options.operationId
    if (options.deprecated !== undefined)
      fn[ROUTE_METADATA_PROP].deprecated = options.deprecated
    if (options.externalDocs)
      fn[ROUTE_METADATA_PROP].externalDocs = options.externalDocs
  }
}

export const Operation = ApiOperation

/**
 * Defines an OpenAPI response definition for a status code.
 *
 * @example
 * ```ts
 * @ApiResponse({ status: 200, description: 'User retrieved successfully', schema: UserResponseSchema })
 * @ApiResponse({ status: 404, description: 'User not found' })
 * getUser() {}
 * ```
 */
export function ApiResponse(options: {
  status: number | string
  description?: string
  schema?: any
}): any {
  return function (
    _target: any,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ) {
    const fn = descriptor.value
    fn[ROUTE_METADATA_PROP] = fn[ROUTE_METADATA_PROP] || {}
    fn[ROUTE_METADATA_PROP].responses = fn[ROUTE_METADATA_PROP].responses || {}
    fn[ROUTE_METADATA_PROP].responses[options.status] = {
      description: options.description || `HTTP ${options.status} Response`,
      schema: options.schema,
    }
  }
}

/**
 * Requires Bearer JWT authentication for this endpoint or controller in OpenAPI.
 *
 * @example
 * ```ts
 * @ApiBearerAuth()
 * @Get('/profile')
 * getProfile() {}
 * ```
 */
export function ApiBearerAuth(name = 'bearerAuth'): any {
  return function (
    target: any,
    propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor
  ) {
    const securityObj = { [name]: [] }
    if (propertyKey && descriptor) {
      const fn = descriptor.value
      fn[ROUTE_METADATA_PROP] = fn[ROUTE_METADATA_PROP] || {}
      fn[ROUTE_METADATA_PROP].security = [
        ...(fn[ROUTE_METADATA_PROP].security || []),
        securityObj,
      ]
    } else {
      target[OPENAPI_CLASS_META] = target[OPENAPI_CLASS_META] || {}
      target[OPENAPI_CLASS_META].security = [
        ...(target[OPENAPI_CLASS_META].security || []),
        securityObj,
      ]
    }
  }
}

export const BearerAuth = ApiBearerAuth

/**
 * Requires custom security scheme authentication for this endpoint or controller.
 */
export function ApiSecurity(name: string, scopes: string[] = []): any {
  return function (
    target: any,
    propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor
  ) {
    const securityObj = { [name]: scopes }
    if (propertyKey && descriptor) {
      const fn = descriptor.value
      fn[ROUTE_METADATA_PROP] = fn[ROUTE_METADATA_PROP] || {}
      fn[ROUTE_METADATA_PROP].security = [
        ...(fn[ROUTE_METADATA_PROP].security || []),
        securityObj,
      ]
    } else {
      target[OPENAPI_CLASS_META] = target[OPENAPI_CLASS_META] || {}
      target[OPENAPI_CLASS_META].security = [
        ...(target[OPENAPI_CLASS_META].security || []),
        securityObj,
      ]
    }
  }
}

/**
 * Excludes a route or controller from OpenAPI / Swagger generation.
 */
export function ApiExclude(): any {
  return function (
    target: any,
    propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor
  ) {
    if (propertyKey && descriptor) {
      const fn = descriptor.value
      fn[ROUTE_METADATA_PROP] = fn[ROUTE_METADATA_PROP] || {}
      fn[ROUTE_METADATA_PROP].excludeFromDocs = true
    } else {
      target[OPENAPI_CLASS_META] = target[OPENAPI_CLASS_META] || {}
      target[OPENAPI_CLASS_META].excludeFromDocs = true
    }
  }
}

/**
 * Annotates a class property with metadata for OpenAPI schema generation.
 */
export function ApiProperty(
  options: {
    description?: string
    example?: any
    required?: boolean
    type?: any
    enum?: any[]
  } = {}
): any {
  return function (target: any, propertyKey: string | symbol) {
    target.constructor[OPENAPI_PROPERTY_META] =
      target.constructor[OPENAPI_PROPERTY_META] || {}
    target.constructor[OPENAPI_PROPERTY_META][propertyKey] = options
  }
}
