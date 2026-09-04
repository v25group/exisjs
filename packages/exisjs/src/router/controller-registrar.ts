import type { App } from '../server/app'

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
          let instance: any = this.app.container.resolve(ControllerClass)
          if (!instance) {
            // Auto-instantiate if not provided via DI
            instance = new ControllerClass()
            this.app.container.provide(ControllerClass, { useValue: instance })
          }
          try {
            // 0. Enforce Route Permissions (Role Authorization)
            const routeMetadata = routeMetadataMap[route.handlerName] || {}
            const permissions = routeMetadata.permissions
            if (permissions && permissions.length > 0) {
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

            // 1. Run Guards
            const routeLifecycle = lifecycleMetadataMap[route.handlerName] || {}
            const guards = [
              ...(lifecycleMetadataMap._classGuards || []),
              ...(routeLifecycle.guards || []),
            ]
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
                  allowed = await guardInstance.canActivate(req)
                } else {
                  allowed = await guard(req)
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

            // 2. Resolve parameters
            const paramMetadata = paramMetadataMap[route.handlerName] || []
            const args: any[] = []

            if (paramMetadata.length === 0) {
              if (method === 'ws' || method === 'sse') {
                args.push(req, streamOrSocket)
              } else {
                args.push(req, res, next)
              }
            } else {
              for (const param of paramMetadata) {
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
                    rawArg = req.body
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
                  default:
                    rawArg = undefined
                }

                if (param.pipes && param.pipes.length > 0) {
                  for (const pipe of param.pipes) {
                    if (
                      typeof pipe === 'function' &&
                      pipe.prototype?.transform
                    ) {
                      let pipeInstance: any = this.app.container.resolve(pipe)
                      if (!pipeInstance) pipeInstance = new pipe()
                      rawArg = await pipeInstance.transform(rawArg, {
                        type: param.type,
                        name: param.name,
                      })
                    } else if (
                      typeof pipe === 'object' &&
                      typeof pipe.parse === 'function'
                    ) {
                      rawArg = await pipe.parse(rawArg)
                    } else if (
                      typeof pipe === 'object' &&
                      typeof pipe.transform === 'function'
                    ) {
                      rawArg = await pipe.transform(rawArg, {
                        type: param.type,
                        name: param.name,
                      })
                    } else if (typeof pipe === 'function') {
                      rawArg = await pipe(rawArg)
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
                  await interceptorInstance.intercept(req, res)
                } else {
                  await interceptor(req, res)
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
                res.json(result)
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
              if (typeof filter === 'function' && filter.prototype?.catch) {
                let filterInstance: any = this.app.container.resolve(filter)
                if (!filterInstance) filterInstance = new filter()
                await filterInstance.catch(err, { req, res })
                handled = true
                break
              } else if (
                typeof filter === 'object' &&
                typeof filter.catch === 'function'
              ) {
                await filter.catch(err, { req, res })
                handled = true
                break
              }
            }
            if (!handled) {
              if (next) next(err as Error)
              else console.error(`[Exis ${method.toUpperCase()} Error]`, err)
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

        for (const param of paramMetadata) {
          if (!param) continue
          if (param.type === 'body') {
            const bodyPipe = param.pipes?.find(
              (p: any) => p && typeof p.parse === 'function'
            )
            if (bodyPipe) extractedBodySchema = bodyPipe
          }
          if (param.type === 'query') {
            const queryPipe = param.pipes?.find(
              (p: any) => p && typeof p.parse === 'function'
            )
            if (queryPipe) extractedQuerySchema = queryPipe
          }
        }

        const extractedResponseSchema = routeMeta.responseSchema

        if (
          schema ||
          finalHost ||
          extractedBodySchema ||
          extractedQuerySchema ||
          extractedResponseSchema
        ) {
          schema = schema || {}
          if (finalHost) schema.host = finalHost
          if (extractedBodySchema && !schema.body)
            schema.body = extractedBodySchema
          if (extractedQuerySchema && !schema.query)
            schema.query = extractedQuerySchema
          if (extractedResponseSchema && !schema.response)
            schema.response = extractedResponseSchema

          ;(this.app.router as any)[method](
            fullPath,
            ...allMiddlewares,
            schema,
            finalHandler
          )
        } else {
          ;(this.app.router as any)[method](
            fullPath,
            ...allMiddlewares,
            finalHandler
          )
        }
      }
    }
    return this.app
  }
}
