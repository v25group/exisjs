import type { RouteSchema } from '../types'
import {
  PARAM_METADATA_PROP,
  ROUTE_META,
  ROUTE_REGISTRY,
  ROUTE_METADATA_PROP,
} from './constants'
import { MetadataEngine } from './core/metadata'

export interface CustomParamExecutionContext {
  req: any
  res: any
  next: any
  app: any
  state: Record<string, any>
  switchToHttp: () => {
    getRequest: () => any
    getResponse: () => any
    getNext: () => any
  }
}

export type CustomParamFactory<TData = any, TResult = any> = (
  data: TData,
  ctx: CustomParamExecutionContext
) => TResult

/**
 * Creates a custom route parameter decorator.
 *
 * Example:
 * ```ts
 * export const CurrentUser = createParamDecorator(
 *   (data: string | undefined, ctx) => {
 *     const req = ctx.req
 *     return data ? req.user?.[data] : req.user
 *   }
 * )
 *
 * // Usage in controller:
 * @Get('/profile')
 * getProfile(@CurrentUser() user: any, @CurrentUser('id') id: string) {}
 * ```
 */
export function createParamDecorator<TData = any>(
  factory: CustomParamFactory<TData>
): (data?: TData, ...pipes: any[]) => ParameterDecorator
export function createParamDecorator(
  type: string,
  nameOrPipe?: string | any,
  ...pipes: any[]
): ParameterDecorator
export function createParamDecorator(
  typeOrFactory: string | CustomParamFactory<any>,
  nameOrPipe?: string | any,
  ...pipes: any[]
): any {
  if (typeof typeOrFactory === 'function') {
    const factory = typeOrFactory
    return function (dataOrPipe?: any, ...customPipes: any[]) {
      return function (
        target: any,
        propertyKey: string | symbol,
        parameterIndex: number
      ) {
        const isPipe =
          typeof dataOrPipe === 'function' ||
          (typeof dataOrPipe === 'object' &&
            dataOrPipe !== null &&
            (typeof dataOrPipe.transform === 'function' ||
              typeof dataOrPipe.parse === 'function'))
        const data = isPipe ? undefined : dataOrPipe
        const allPipes = isPipe ? [dataOrPipe, ...customPipes] : customPipes

        const fn = target[propertyKey]
        const paramMeta = MetadataEngine.init<any[]>(
          fn,
          PARAM_METADATA_PROP,
          []
        )
        paramMeta[parameterIndex] = {
          type: 'customParam',
          name: data,
          customFactory: factory,
          pipes: allPipes,
        }
      }
    }
  }

  const type = typeOrFactory
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

import { logger } from '../logger'

export const Param = (nameOrPipe?: string | any, ...pipes: any[]) =>
  createParamDecorator('param', nameOrPipe, ...pipes)

export const Body = (nameOrPipe?: string | any, ...pipes: any[]) => {
  if (nameOrPipe === undefined && pipes.length === 0) {
    logger.warn(
      `@Body() decorator used without a validation schema or pipe. It is highly recommended to validate incoming payloads.`
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

/**
 * Injects a query parameter from the URL query string.
 *
 * Example:
 * ```ts
 * @Get('/search')
 * search(@QueryParam('q') q: string) { return { q }; }
 * ```
 */
export const QueryParam = (nameOrPipe?: string | any, ...pipes: any[]) =>
  createParamDecorator('query', nameOrPipe, ...pipes)

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
      return (QueryParam(pathOrName, schemaOrPipe, ...pipes) as any)(
        target,
        contextOrPropertyKey,
        descriptorOrIndex
      )
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
