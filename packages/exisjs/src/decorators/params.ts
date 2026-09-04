import type { RouteSchema } from '../types'
import {
  PARAM_METADATA_PROP,
  ROUTE_META,
  ROUTE_REGISTRY,
  ROUTE_METADATA_PROP,
} from './constants'
import { MetadataEngine } from './core/metadata'

function createParamDecorator(
  type: string,
  nameOrPipe?: string | any,
  ...pipes: any[]
) {
  return function (
    target: any,
    propertyKey: string | symbol,
    parameterIndex: number
  ) {
    const isPipe =
      typeof nameOrPipe === 'function' ||
      (typeof nameOrPipe === 'object' && nameOrPipe !== null)
    const name = isPipe ? undefined : nameOrPipe
    const allPipes = isPipe ? [nameOrPipe, ...pipes] : pipes

    const fn = target[propertyKey]
    const paramMeta = MetadataEngine.init<any[]>(fn, PARAM_METADATA_PROP, [])
    paramMeta[parameterIndex] = { type, name, pipes: allPipes }
  }
}

export const Param = (nameOrPipe?: string | any, ...pipes: any[]) =>
  createParamDecorator('param', nameOrPipe, ...pipes)

export const Body = (nameOrPipe?: string | any, ...pipes: any[]) => {
  if (nameOrPipe === undefined && pipes.length === 0) {
    console.warn(
      `\x1b[33m[ExisJS] Warning: @Body() decorator used without a validation schema or pipe. It is highly recommended to validate incoming payloads.\x1b[0m`
    )
  }
  return createParamDecorator('body', nameOrPipe, ...pipes)
}

export const Headers = (nameOrPipe?: string | any, ...pipes: any[]) =>
  createParamDecorator('header', nameOrPipe, ...pipes)
export const HostParam = (nameOrPipe?: string | any, ...pipes: any[]) =>
  createParamDecorator('host', nameOrPipe, ...pipes)
export const Req = () => createParamDecorator('req')
export const Socket = () => createParamDecorator('socket')
export const Stream = () => createParamDecorator('stream')
export const Session = () => createParamDecorator('session')
export const Next = () => createParamDecorator('next')
export const Ip = () => createParamDecorator('ip')
export const UploadedFile = (nameOrPipe?: string | any, ...pipes: any[]) =>
  createParamDecorator('uploadedFile', nameOrPipe, ...pipes)
export const UploadedFiles = (nameOrPipe?: string | any, ...pipes: any[]) =>
  createParamDecorator('uploadedFiles', nameOrPipe, ...pipes)

export const Res = (options?: { passthrough?: boolean }): any => {
  return function (
    target: any,
    propertyKey: string | symbol,
    parameterIndex: number
  ) {
    const fn = target[propertyKey]
    const paramMeta = MetadataEngine.init<any[]>(fn, PARAM_METADATA_PROP, [])
    paramMeta[parameterIndex] = { type: 'res' }

    const routeMeta = MetadataEngine.init<any>(fn, ROUTE_METADATA_PROP, {})
    routeMeta.manualRes = !options?.passthrough
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
      const isPipe =
        typeof pathOrName === 'function' ||
        (typeof pathOrName === 'object' && pathOrName !== null)
      const name = isPipe ? undefined : pathOrName
      const pipesArray: any[] = isPipe ? [pathOrName] : []
      if (
        schemaOrPipe &&
        (typeof schemaOrPipe === 'function' || typeof schemaOrPipe === 'object')
      ) {
        pipesArray.push(schemaOrPipe)
      }
      pipesArray.push(...pipes)

      const parameterIndex = descriptorOrIndex
      const fn = target[contextOrPropertyKey]
      const paramMeta = MetadataEngine.init<any[]>(fn, PARAM_METADATA_PROP, [])
      paramMeta[parameterIndex] = {
        type: 'query',
        name,
        pipes: pipesArray,
      }
    } else {
      const path = pathOrName || ''
      if (
        typeof contextOrPropertyKey === 'object' &&
        contextOrPropertyKey !== null &&
        'name' in contextOrPropertyKey
      ) {
        MetadataEngine.set(target, ROUTE_META, {
          method: 'QUERY',
          path,
          schema: schemaOrPipe,
        })
      } else {
        const proto = typeof target === 'function' ? target.prototype : target
        const name = contextOrPropertyKey || descriptorOrIndex?.name
        MetadataEngine.push(proto, ROUTE_REGISTRY, {
          method: 'QUERY',
          path,
          schema: schemaOrPipe,
          handlerName: name,
        })
      }
    }
  }
}
