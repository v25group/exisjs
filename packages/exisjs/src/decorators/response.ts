import type { RouteSchema } from '../types'
import { ROUTE_METADATA_PROP, CONTROLLER_HOST } from './constants'

/**
 * Defines a custom HTTP status code for a successful response.
 *
 * Example:
 *
 *     @Post('/')
 *     @HttpCode(201)
 *     create() {}
 *
 * @param {number} code HTTP Status code
 * @public
 */
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

/**
 * Defines the response schema for OpenAPI generation.
 *
 * Example:
 *
 *     @Get('/')
 *     @Returns(tex.object({ id: tex.string() }))
 *     getUser() {}
 *
 * @param {RouteSchema['response']} schema The response schema
 * @public
 */
export function Returns(
  schema: RouteSchema<any, any, any, any>['response']
): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    const isStandard =
      typeof contextOrPropertyKey === 'object' && contextOrPropertyKey !== null
    const fn = isStandard ? target : descriptor.value

    fn[ROUTE_METADATA_PROP] = fn[ROUTE_METADATA_PROP] || {}
    fn[ROUTE_METADATA_PROP].responseSchema = schema
  }
}

export const Redirect = (url: string, statusCode = 302): any => {
  return function (target: any, propertyKey: string | symbol) {
    const fn = target[propertyKey]
    fn[ROUTE_METADATA_PROP] = fn[ROUTE_METADATA_PROP] || {}
    fn[ROUTE_METADATA_PROP].redirect = { url, statusCode }
  }
}

export const Permissions = (...permissions: string[]): any => {
  return function (target: any, propertyKey?: string | symbol) {
    if (propertyKey) {
      const fn = target[propertyKey]
      fn[ROUTE_METADATA_PROP] = fn[ROUTE_METADATA_PROP] || {}
      fn[ROUTE_METADATA_PROP].permissions = permissions
    } else {
      const proto = typeof target === 'function' ? target.prototype : target
      proto[ROUTE_METADATA_PROP] = proto[ROUTE_METADATA_PROP] || {}
      proto[ROUTE_METADATA_PROP].permissions = permissions
    }
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
