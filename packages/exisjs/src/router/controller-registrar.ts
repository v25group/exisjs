import { BadRequestException } from '../error'
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

        const executeCore = async (
          req: import('../types').Request,
          res: import('../types').Response,
          next: import('../types').NextFunction,
          streamOrSocket?: any
        ) => {
          let instance: any
          try {
            instance = this.app.container.resolve(ControllerClass)
          } catch {
            instance = this.app.container.instantiateClass(ControllerClass)
            this.app.container.provide(ControllerClass, { useValue: instance })
          }

          try {
            // 0. Enforce Route Security & Permissions (Role / Permissions / Public)
            const routeMetadata = routeMetadataMap[route.handlerName] || {}
            const isPublic =
              routeMetadata.isPublic ||
              ControllerClass.prototype[IS_PUBLIC_METADATA] ||
              (ControllerClass.prototype[route.handlerName] &&
                ControllerClass.prototype[route.handlerName][
                  IS_PUBLIC_METADATA
                ])
            ;(req as any).isPublic = isPublic

            const permissions = [
              ...(ControllerClass.prototype[PERMISSIONS_METADATA] || []),
              ...(routeMetadata.permissions || []),
              ...(ControllerClass.prototype[route.handlerName]?.[
                PERMISSIONS_METADATA
              ] || []),
            ]

            const roles = [
              ...(ControllerClass.prototype[ROLES_METADATA] || []),
              ...(routeMetadata.roles || []),
              ...(ControllerClass.prototype[route.handlerName]?.[
                ROLES_METADATA
              ] || []),
            ]

            const isSuperAdmin = Boolean(req.user?.isSuperAdmin)

            if (!isSuperAdmin && permissions.length > 0) {
              const userPerms =
                req.user?.permissions || (req.user?.role ? [req.user.role] : [])
              const hasPermission = permissions.some((p: string) =>
                userPerms.includes(p)
              )
              if (!hasPermission) {
                if (res) {
                  res.status(403).json({
                    success: false,
                    error: {
                      code: 'FORBIDDEN',
                      message:
                        'Insufficient permissions to access this resource',
                    },
                  })
                }
                return
              }
            }

            if (!isSuperAdmin && roles.length > 0) {
              const userRoles = Array.isArray(req.user?.roles)
                ? req.user.roles
                : req.user?.role
                  ? [req.user.role]
                  : []
              const hasRole = roles.some((r: string) => userRoles.includes(r))
              if (!hasRole) {
                if (res) {
                  res.status(403).json({
                    success: false,
                    error: {
                      code: 'FORBIDDEN',
                      message: 'Insufficient role to access this resource',
                    },
                  })
                }
                return
              }
            }

            // 1. Run Guards
            const routeLifecycle = lifecycleMetadataMap[route.handlerName] || {}
            const guards = [
              ...(lifecycleMetadataMap._classGuards || []),
              ...(routeLifecycle.guards || []),
            ]

            const executionCtx = Object.assign(Object.create(req), {
              req,
              res,
              next,
              app: this.app,
              state:
                executionContext.getStore()?.state || (req as any).state || {},
              getClass: () => ControllerClass,
              getHandler: () => ControllerClass.prototype[route.handlerName],
              getType: () => (method === 'ws' ? 'ws' : 'http'),
              switchToHttp: () => ({
                getRequest: () => req,
                getResponse: () => res,
                getNext: () => next,
              }),
            })

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
                  allowed = await guardInstance.canActivate(executionCtx)
                } else {
                  allowed = await guard(executionCtx)
                }
              }
              if (!allowed) {
                if (res) {
                  res.status(403).json({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Forbidden by Guard' },
                  })
                }
                return
              }
            }

            // 2. Resolve parameters & pipes
            const classPipes: any[] =
              ControllerClass.prototype[PIPES_METADATA] || []
            const methodPipes: any[] =
              (ControllerClass.prototype[route.handlerName] &&
                ControllerClass.prototype[route.handlerName][PIPES_METADATA]) ||
              []
            const combinedMethodPipes = [...classPipes, ...methodPipes]

            const reflectedTypes: any[] =
              (typeof (globalThis as any).Reflect?.getMetadata === 'function'
                ? (globalThis as any).Reflect.getMetadata(
                    'design:paramtypes',
                    ControllerClass.prototype,
                    route.handlerName
                  )
                : undefined) || []

            const paramMetadata =
              paramMetadataMap[route.handlerName] ||
              (ControllerClass.prototype[route.handlerName] &&
                ControllerClass.prototype[route.handlerName][
                  PARAM_METADATA_PROP
                ]) ||
              []
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
                        await req.json().catch(() => {
                          /* noop */
                        })
                      } else if (contentType.includes('form')) {
                        await req.formData().catch(() => {
                          /* noop */
                        })
                      }
                    }
                    rawArg = param.name
                      ? (req.body as any)?.[param.name]
                      : req.body
                    break
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
                      typeof pipe.transform === 'function'
                    ) {
                      rawArg = await pipe.transform(rawArg, argMetadata)
                    } else if (
                      typeof pipe === 'object' &&
                      pipe !== null &&
                      typeof pipe.parse === 'function'
                    ) {
                      rawArg = await pipe.parse(rawArg)
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
                        throw new BadRequestException('Validation Failed', {
                          statusCode: 400,
                          validationErrors: errors,
                        })
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

            // 3. Execute Custom Interceptors
            const interceptors = [
              ...(lifecycleMetadataMap._classInterceptors || []),
              ...(routeLifecycle.interceptors || []),
            ]
            for (const interceptor of interceptors) {
              if (typeof interceptor === 'function') {
                if (
                  interceptor.prototype &&
                  typeof interceptor.prototype.intercept === 'function'
                ) {
                  let interceptorInstance: any =
                    this.app.container.resolve(interceptor)
                  if (!interceptorInstance) {
                    interceptorInstance = new (interceptor as any)()
                  }
                  await interceptorInstance.intercept(executionCtx, {
                    handle: async () => instance[route.handlerName](...args),
                  })
                } else {
                  await interceptor(executionCtx, res)
                }
              }
            }

            // 4. Invoke the method
            const result = await instance[route.handlerName](...args)

            if (res && !res.headersSent) {
              const routeMeta = routeMetadataMap[route.handlerName] || {}

              if (routeMeta.redirect) {
                res.redirect(
                  routeMeta.redirect.url,
                  routeMeta.redirect.statusCode
                )
                return
              }

              // Apply custom headers
              if (routeMeta.headers) {
                for (const [name, val] of Object.entries(routeMeta.headers)) {
                  res.setHeader(name, val as string)
                }
              }
              // Apply custom HTTP Code
              if (routeMeta.httpCode) {
                res.status(routeMeta.httpCode)
              }

              if (result !== undefined) {
                if (
                  result &&
                  (typeof result.pipe === 'function' ||
                    (typeof result.getReader === 'function' &&
                      typeof result.tee === 'function') ||
                    (typeof result[Symbol.asyncIterator] === 'function' &&
                      !Array.isArray(result)))
                ) {
                  ;(res as any).sendStream(result)
                } else if (!(
                  result &&
                  typeof (result as any).send === 'function' &&
                  typeof (result as any).onClose === 'function'
                )) {
                  res.json(result)
                }
              }
            }
          } catch (err) {
            let handled = false
            const routeLifecycle = lifecycleMetadataMap[route.handlerName] || {}
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
              if (next) next(err as Error)
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
