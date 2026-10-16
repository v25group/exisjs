import { validationFailed } from '../decorators/pipes'
import { HttpError } from '../error/errors'
import { checkAccess, toAccessList, type AccessRule } from './authorize'
import {
  sendResult,
  isResponseStarted,
  answerIfUnsent,
  toError,
} from './send-result'
import type { App } from '../server/app'
import { executionContext } from '../server/context'

export class ControllerRegistrar {
  constructor(private app: App<any>) {}

  // ─── Class-Based Controllers Registration ──────────────────────────────────

  public registerControllers(
    controllers: any[],
    basePath = '',
    prefixMiddlewares: any[] = []
  ): App<any> {
    return this._registerControllers(controllers, basePath, prefixMiddlewares)
  }

  private _registerControllers(
    controllers: any[],
    basePath = '',
    prefixMiddlewares: any[] = []
  ): App<any> {
    const ROUTE_REGISTRY = Symbol.for('exisjs:routes')
    const CONTROLLER_PREFIX = Symbol.for('exisjs:controller_prefix')
    const CONTROLLER_HOST = Symbol.for('exisjs:controller_host')
    const MIDDLEWARE_REGISTRY = Symbol.for('exisjs:middlewares')
    const ROUTE_METADATA = Symbol.for('exisjs:route_metadata')
    const LIFECYCLE_METADATA = Symbol.for('exisjs:lifecycle_metadata')
    const PARAM_METADATA = Symbol.for('exisjs:param_metadata')
    const PARAM_METADATA_PROP = Symbol.for('exisjs:param_metadata_prop')
    const PERMISSIONS_METADATA = Symbol.for('exisjs:permissions')
    const ROLES_METADATA = Symbol.for('exisjs:roles')
    const IS_PUBLIC_METADATA = Symbol.for('exisjs:is_public')
    const CATCH_EXCEPTIONS_METADATA = Symbol.for('exisjs:catch_exceptions')

    const PIPES_METADATA = Symbol.for('exisjs:pipes')

    for (const ControllerClass of controllers) {
      const prefix = ControllerClass.prototype[CONTROLLER_PREFIX] || ''
      const host = ControllerClass.prototype[CONTROLLER_HOST]
      const routes = ControllerClass.prototype[ROUTE_REGISTRY] || []
      const classMiddlewares = [
        ...(Array.isArray(ControllerClass.prototype[MIDDLEWARE_REGISTRY])
          ? ControllerClass.prototype[MIDDLEWARE_REGISTRY]
          : ControllerClass.prototype[MIDDLEWARE_REGISTRY]?._classMiddlewares ||
            []),
      ]
      const methodMiddlewares =
        (!Array.isArray(ControllerClass.prototype[MIDDLEWARE_REGISTRY])
          ? ControllerClass.prototype[MIDDLEWARE_REGISTRY]
          : {}) || {}

      const routeMetadataMap = ControllerClass.prototype[ROUTE_METADATA] || {}
      const lifecycleMetadataMap =
        ControllerClass.prototype[LIFECYCLE_METADATA] || {}
      const paramMetadataMap = ControllerClass.prototype[PARAM_METADATA] || {}

      for (const route of routes) {
        const method = route.method.toLowerCase() as any

        // Everything below depends only on the route, so it is computed once
        // at registration instead of on every request
        const handlerFn = ControllerClass.prototype[route.handlerName]
        const routeMetadata = routeMetadataMap[route.handlerName] || {}
        const isPublic = Boolean(
          routeMetadata.isPublic ||
          ControllerClass.prototype[IS_PUBLIC_METADATA] ||
          handlerFn?.[IS_PUBLIC_METADATA]
        )
        const accessRule: AccessRule = {
          isPublic,
          permissions: [
            ...toAccessList(ControllerClass.prototype[PERMISSIONS_METADATA]),
            ...toAccessList(routeMetadata.permissions),
            ...toAccessList(handlerFn?.[PERMISSIONS_METADATA]),
          ],
          roles: [
            ...toAccessList(ControllerClass.prototype[ROLES_METADATA]),
            ...toAccessList(routeMetadata.roles),
            ...toAccessList(handlerFn?.[ROLES_METADATA]),
          ],
        }
        if (
          isPublic &&
          (accessRule.roles.length > 0 || accessRule.permissions.length > 0)
        ) {
          this.app.log.warn(
            `[exis] ${ControllerClass.name}.${String(route.handlerName)} is @Public() and also declares roles or permissions; @Public() wins and the route is open.`
          )
        }

        const routeLifecycle = lifecycleMetadataMap[route.handlerName] || {}
        const guards = [
          ...(lifecycleMetadataMap._classGuards || []),
          ...(routeLifecycle.guards || []),
        ]
        const interceptors = [
          ...(lifecycleMetadataMap._classInterceptors || []),
          ...(routeLifecycle.interceptors || []),
        ]
        const declaredParams: any[] =
          paramMetadataMap[route.handlerName] ||
          handlerFn?.[PARAM_METADATA_PROP] ||
          []
        // A handler that can reach the response may send it later (callback
        // style); one that cannot must be answered when it settles.
        const ownsResponse =
          method === 'ws' ||
          method === 'sse' ||
          (declaredParams.length === 0
            ? (handlerFn?.length ?? 0) >= 2
            : declaredParams.some(
                (p: any) => p && (p.type === 'res' || p.type === 'next')
              ))

        const combinedMethodPipes: any[] = [
          ...(ControllerClass.prototype[PIPES_METADATA] || []),
          ...(handlerFn?.[PIPES_METADATA] || []),
        ]
        const reflectedTypes: any[] =
          (typeof (globalThis as any).Reflect?.getMetadata === 'function'
            ? (globalThis as any).Reflect.getMetadata(
                'design:paramtypes',
                ControllerClass.prototype,
                route.handlerName
              )
            : undefined) || []

        const executeCore = async (
          req: import('../types').Request,
          res: import('../types').Response,
          next: import('../types').NextFunction,
          streamOrSocket?: any
        ) => {
          try {
            // Resolved per request so request-scoped dependencies are fresh;
            // singleton controllers come straight from the container cache
            const instance: any =
              this.app.container.peekSingleton(ControllerClass) ??
              this.app.container.resolve(
                ControllerClass,
                (req as any)?._diCache ?? new Map()
              )

            ;(req as any).isPublic = isPublic
            checkAccess(req.user, accessRule, this.app.options.authorization)

            // Built only for guards and interceptors
            let executionCtx: any
            const getExecutionCtx = () =>
              (executionCtx ??= Object.assign(Object.create(req), {
                req,
                res,
                next,
                app: this.app,
                state:
                  executionContext.getStore()?.state ||
                  (req as any).state ||
                  {},
                getClass: () => ControllerClass,
                getHandler: () => ControllerClass.prototype[route.handlerName],
                getType: () => (method === 'ws' ? 'ws' : 'http'),
                switchToHttp: () => ({
                  getRequest: () => req,
                  getResponse: () => res,
                  getNext: () => next,
                }),
              }))

            // 1. Run Guards
            for (const guard of guards) {
              let allowed = false
              if (typeof guard === 'function') {
                if (
                  guard.prototype &&
                  typeof guard.prototype.canActivate === 'function'
                ) {
                  let guardInstance: any = this.app.container.resolve(guard)
                  if (!guardInstance) {
                    guardInstance = new (guard as any)()
                  }
                  allowed = await guardInstance.canActivate(getExecutionCtx())
                } else {
                  allowed = await guard(getExecutionCtx())
                }
              }
              if (!allowed) {
                // A guard may already have answered (for example with 401)
                if (res && isResponseStarted(res)) return
                throw new HttpError('Forbidden by Guard', 403, 'FORBIDDEN')
              }
            }

            // 2. Resolve parameters & pipes
            const paramMetadata = declaredParams
            const args: any[] = []

            if (paramMetadata.length === 0) {
              if (method === 'ws' || method === 'sse') {
                args.push(req, streamOrSocket)
              } else {
                args.push(req, res, next)
              }
            } else {
              for (let i = 0; i < paramMetadata.length; i++) {
                const param = paramMetadata[i]
                if (!param) {
                  args.push(undefined)
                  continue
                }
                let rawArg: any
                switch (param.type) {
                  case 'req':
                    rawArg = req
                    break
                  case 'res':
                    rawArg = res
                    break
                  case 'body':
                    if (
                      req.body === undefined &&
                      ['POST', 'PUT', 'PATCH'].includes(req.method!)
                    ) {
                      const contentType = req.headers['content-type'] || ''
                      if (contentType.includes('json')) {
                        await req.json()
                      } else if (contentType.includes('form')) {
                        await req.formData()
                      }
                    }
                    rawArg = param.name
                      ? (req.body as any)?.[param.name]
                      : req.body
                    break
                  case 'rawBody': {
                    // A read error (body over the limit, client abort) must
                    // reach the error handler, not become an empty body
                    const isStringEncoding =
                      param.name === 'string' ||
                      param.name === 'utf8' ||
                      param.name === 'utf-8' ||
                      (typeof param.name === 'object' &&
                        param.name !== null &&
                        param.name.encoding === 'utf8')
                    rawArg = isStringEncoding
                      ? await req.text()
                      : await req.buffer()
                    break
                  }
                  case 'param':
                    rawArg = param.name ? req.params[param.name] : req.params
                    break
                  case 'query':
                    rawArg = param.name ? req.query[param.name] : req.query
                    break
                  case 'header':
                    rawArg = param.name
                      ? req.headers[param.name.toLowerCase()]
                      : req.headers
                    break
                  case 'session':
                    rawArg = (req as any).session
                    break
                  case 'next':
                    rawArg = next
                    break
                  case 'host':
                    rawArg = param.name
                      ? (req.params as any)[param.name]
                      : req.hostname
                    break
                  case 'socket':
                  case 'stream':
                    rawArg = streamOrSocket
                    break
                  case 'ip':
                    rawArg = req.ip
                    break
                  case 'uploadedFile':
                  case 'uploadedFiles':
                    if (
                      req.body === undefined &&
                      ['POST', 'PUT', 'PATCH'].includes(req.method!)
                    ) {
                      await req.formData().catch(() => {
                        /* noop */
                      })
                    }
                    if (req.files) {
                      const isMulti = param.type === 'uploadedFiles'
                      let files: any[] = []
                      if (param.name) {
                        files = req.files.filter(
                          (f: any) => f.fieldname === param.name
                        )
                      } else {
                        files = req.files
                      }
                      rawArg = isMulti ? files : files[0]
                    }
                    break
                  case 'cookies':
                  case 'cookie':
                    rawArg = param.name
                      ? (req.cookies as any)?.[param.name]
                      : req.cookies
                    break
                  case 'state': {
                    const storeState = executionContext.getStore()?.state
                    const reqState = (req as any).state
                    const stateObj = {
                      ...(storeState || {}),
                      ...(reqState || {}),
                    }
                    rawArg = param.name ? stateObj[param.name] : stateObj
                    break
                  }
                  case 'app':
                    rawArg = this.app
                    break
                  case 'fields':
                    rawArg = param.name
                      ? (req as any).fields?.[param.name]
                      : (req as any).fields
                    break
                  case 'customParam':
                    if (typeof param.customFactory === 'function') {
                      const executionCtx = {
                        req,
                        res,
                        next,
                        app: this.app,
                        state: executionContext.getStore()?.state || {},
                        switchToHttp: () => ({
                          getRequest: () => req,
                          getResponse: () => res,
                          getNext: () => next,
                        }),
                      }
                      rawArg = param.customFactory(param.name, executionCtx)
                    } else {
                      rawArg = undefined
                    }
                    break
                  default:
                    rawArg = undefined
                }

                const allPipes = [
                  ...combinedMethodPipes,
                  ...(param.pipes || []),
                ]
                if (allPipes.length > 0) {
                  let metatype = param.metatype || reflectedTypes[i]
                  for (const pipe of allPipes) {
                    if (
                      typeof pipe === 'function' &&
                      pipe.prototype &&
                      !pipe.prototype.transform &&
                      typeof pipe.prototype.validate === 'function'
                    ) {
                      metatype = pipe
                    }

                    const argMetadata = {
                      type: param.type,
                      data: param.name,
                      metatype,
                    }
                    if (
                      typeof pipe === 'function' &&
                      pipe.prototype?.transform
                    ) {
                      let pipeInstance: any = this.app.container.resolve(pipe)
                      if (!pipeInstance) pipeInstance = new pipe()
                      rawArg = await pipeInstance.transform(rawArg, argMetadata)
                    } else if (
                      typeof pipe === 'object' &&
                      pipe !== null &&
                      typeof pipe.parse === 'function'
                    ) {
                      // Set auto-coercion flag for query/param schemas
                      if (
                        (param.type === 'query' || param.type === 'param') &&
                        !pipe._isQueryOrParam
                      ) {
                        pipe._isQueryOrParam = true
                      }
                      rawArg = await pipe.parse(rawArg)
                    } else if (
                      typeof pipe === 'object' &&
                      pipe !== null &&
                      typeof pipe.transform === 'function'
                    ) {
                      rawArg = await pipe.transform(rawArg, argMetadata)
                    } else if (
                      typeof pipe === 'function' &&
                      pipe.prototype &&
                      typeof pipe.prototype.validate === 'function'
                    ) {
                      // Validating DTO Class directly
                      const instance = new pipe()
                      Object.assign(instance, rawArg)
                      const errors = await instance.validate()
                      if (
                        errors &&
                        (Array.isArray(errors)
                          ? errors.length > 0
                          : Boolean(errors))
                      ) {
                        throw validationFailed(errors)
                      }
                      rawArg = instance
                    } else if (typeof pipe === 'function') {
                      try {
                        rawArg = await pipe(rawArg, argMetadata)
                      } catch (err) {
                        if (
                          String(err).includes('cannot be invoked without') ||
                          String(err).includes('Class constructor')
                        ) {
                          metatype = pipe
                        } else {
                          throw err
                        }
                      }
                    }
                  }
                }

                args.push(rawArg)
              }
            }

            // 3. Interceptors wrap the handler: each receives next.handle(),
            // and what it returns is the route's result
            let invoke = async () => instance[route.handlerName](...args)
            for (let i = interceptors.length - 1; i >= 0; i--) {
              const interceptor = interceptors[i]
              const inner = invoke
              invoke = async () => {
                if (
                  typeof interceptor === 'function' &&
                  typeof interceptor.prototype?.intercept === 'function'
                ) {
                  const interceptorInstance: any =
                    this.app.container.resolve(
                      interceptor,
                      (req as any)?._diCache
                    ) || new (interceptor as any)()
                  return interceptorInstance.intercept(getExecutionCtx(), {
                    handle: inner,
                  })
                }
                if (
                  interceptor &&
                  typeof interceptor === 'object' &&
                  typeof interceptor.intercept === 'function'
                ) {
                  return interceptor.intercept(getExecutionCtx(), {
                    handle: inner,
                  })
                }
                if (typeof interceptor === 'function') {
                  if (interceptor.length >= 2) {
                    return interceptor(getExecutionCtx(), { handle: inner })
                  }
                  await interceptor(getExecutionCtx())
                }
                return inner()
              }
            }

            // 4. Invoke the method
            const result = await invoke()

            if (res && !isResponseStarted(res)) {
              if (routeMetadata.redirect) {
                res.redirect(
                  routeMetadata.redirect.url,
                  routeMetadata.redirect.statusCode
                )
                return
              }
              if (routeMetadata.headers) {
                for (const [name, val] of Object.entries(
                  routeMetadata.headers
                )) {
                  res.setHeader(name, val as string)
                }
              }
              if (routeMetadata.httpCode) {
                res.status(routeMetadata.httpCode)
              }
              sendResult(result, res)
              if (!ownsResponse) answerIfUnsent(res)
            }
          } catch (err) {
            let handled = false
            const filters = [
              ...(lifecycleMetadataMap._classFilters || []),
              ...(routeLifecycle.filters || []),
            ]
            for (const filter of filters) {
              const handledExceptions =
                (typeof filter === 'function' &&
                  filter.prototype?.[CATCH_EXCEPTIONS_METADATA]) ||
                (typeof filter === 'object' &&
                  filter?.[CATCH_EXCEPTIONS_METADATA]) ||
                []

              if (handledExceptions.length > 0) {
                const matches = handledExceptions.some((exClass: any) => {
                  if (typeof exClass === 'function') {
                    return (
                      err instanceof exClass ||
                      (err as any)?.name === exClass?.name ||
                      (err as any)?.constructor?.name === exClass?.name
                    )
                  }
                  return false
                })
                if (!matches) continue
              }

              const host = {
                req,
                res,
                next,
                getClass: () => ControllerClass,
                getHandler: () => ControllerClass.prototype[route.handlerName],
                switchToHttp: () => ({
                  getRequest: () => req,
                  getResponse: () => res,
                  getNext: () => next,
                }),
              }

              if (typeof filter === 'function' && filter.prototype?.catch) {
                let filterInstance: any = this.app.container.resolve(filter)
                if (!filterInstance) filterInstance = new filter()
                await filterInstance.catch(err, host)
                handled = true
                break
              } else if (
                typeof filter === 'object' &&
                typeof filter.catch === 'function'
              ) {
                await filter.catch(err, host)
                handled = true
                break
              } else if (typeof filter === 'function') {
                if (filter.length >= 3) {
                  await filter(err, req, res, next)
                } else if (filter.length === 2) {
                  await filter(err, host)
                } else {
                  await filter(err)
                }
                handled = true
                break
              }
            }
            if (!handled) {
              if (next) next(toError(err))
              else
                this.app.log.error({ err, method }, '[Exis Controller Error]')
            }
          }
        }

        let finalHandler: any
        if (method === 'ws' || method === 'sse') {
          finalHandler = async (streamOrSocket: any, rawReq: any) => {
            await executeCore(
              rawReq,
              undefined as any,
              undefined as any,
              streamOrSocket
            )
          }
        } else {
          finalHandler = async (
            req: import('../types').Request,
            res: import('../types').Response,
            next: import('../types').NextFunction
          ) => {
            await executeCore(req, res, next)
          }
        }

        const fullPath =
          (basePath + prefix + route.path).replace(/\/+/g, '/') || '/'

        const routeSpecificMiddlewares =
          methodMiddlewares[route.handlerName] || []
        const allMiddlewares = [
          ...prefixMiddlewares,
          ...classMiddlewares,
          ...routeSpecificMiddlewares,
        ]

        const routeMeta = routeMetadataMap[route.handlerName] || {}
        const finalHost = routeMeta.hosts || host

        let schema = route.schema
        const paramMetadata = paramMetadataMap[route.handlerName] || []

        let extractedBodySchema: any = undefined
        let extractedQuerySchema: any = undefined
        let extractedParamsSchema: any = undefined
        let extractedHeadersSchema: any = undefined

        for (const param of paramMetadata) {
          if (!param) continue
          const pipeOrSchema =
            param.pipes?.find(
              (p: any) =>
                p &&
                (typeof p.parse === 'function' ||
                  typeof p.transform === 'function' ||
                  typeof p === 'function')
            ) || param.metatype

          const isRealSchema =
            pipeOrSchema &&
            (typeof pipeOrSchema.parse === 'function' ||
              typeof pipeOrSchema.toOpenApi === 'function' ||
              pipeOrSchema._raw ||
              pipeOrSchema._def ||
              (pipeOrSchema &&
                typeof pipeOrSchema === 'object' &&
                'type' in pipeOrSchema))

          if (param.type === 'body' && isRealSchema) {
            extractedBodySchema = pipeOrSchema
          }
          if (param.type === 'query' && isRealSchema) {
            extractedQuerySchema = pipeOrSchema
          }
          if (param.type === 'param' && isRealSchema) {
            extractedParamsSchema = pipeOrSchema
          }
          if (param.type === 'header' && isRealSchema) {
            extractedHeadersSchema = pipeOrSchema
          }
        }

        const extractedResponseSchema = routeMeta.responseSchema
        const classOpenApi =
          (ControllerClass as any)[Symbol.for('exisjs:openapi_class_meta')] ||
          {}
        const mergedTags = [
          ...(classOpenApi.tags || []),
          ...(routeMeta.tags || []),
        ]
        const mergedSecurity = [
          ...(classOpenApi.security || []),
          ...(routeMeta.security || []),
        ]

        schema = schema || {}
        // Shown by `exisjs routes`
        schema.access = accessRule
        schema.paramMetadata = paramMetadata
        if (finalHost) schema.host = finalHost

        if (extractedBodySchema && !schema.body)
          schema.body = extractedBodySchema
        if (extractedQuerySchema && !schema.query)
          schema.query = extractedQuerySchema
        if (extractedParamsSchema && !schema.params)
          schema.params = extractedParamsSchema
        if (extractedHeadersSchema && !schema.headers)
          schema.headers = extractedHeadersSchema
        if (extractedResponseSchema && !schema.response)
          schema.response = extractedResponseSchema
        if (mergedTags.length > 0 && !schema.tags) schema.tags = mergedTags
        if (mergedSecurity.length > 0 && !schema.security)
          schema.security = mergedSecurity
        if (routeMeta.summary && !schema.summary)
          schema.summary = routeMeta.summary
        if (routeMeta.description && !schema.description)
          schema.description = routeMeta.description
        if (routeMeta.operationId && !schema.operationId)
          schema.operationId = routeMeta.operationId
        if (
          routeMeta.deprecated !== undefined &&
          schema.deprecated === undefined
        )
          schema.deprecated = routeMeta.deprecated
        if (routeMeta.responses && !schema.responses)
          schema.responses = routeMeta.responses
        if (routeMeta.excludeFromDocs || classOpenApi.excludeFromDocs)
          schema.excludeFromDocs = true

        ;(this.app.router as any)[method](
          fullPath,
          ...allMiddlewares,
          schema,
          finalHandler
        )
      }
    }
    return this.app
  }
}
