import { Router } from '../router'
import { cors } from '../../middleware/middleware'
import { tex } from '../../validator/index'
import { executionContext } from '../../server/context'
import type { App } from '../../server/app'
import { CATCH_EXCEPTIONS_METADATA } from '../../decorators/constants'

/**
 * Compiles a modern functional controller configuration object into an ExisJS Router instance.
 * Assembles middleware, route parameter / body validation, guard checking, context injection,
 * interceptors, transformation pipes, and error interception into an ultra-high performance handler pipeline.
 */
export function compileFunctionalController(config: any, app: App): Router {
  const router = new Router()

  const fileMiddleware: any[] = []
  if (config.cors) {
    fileMiddleware.push(config.cors === true ? cors({}) : cors(config.cors))
  }
  const fileMiddlewareConfig = config.middleware || config.middlewares
  if (fileMiddlewareConfig) {
    fileMiddleware.push(
      ...(Array.isArray(fileMiddlewareConfig)
        ? fileMiddlewareConfig
        : [fileMiddlewareConfig])
    )
  }

  const { onError, onResponse } = config

  for (const [key, routeConfig] of Object.entries(config)) {
    if (
      [
        'cors',
        'middleware',
        'middlewares',
        'guards',
        'interceptors',
        'filters',
        'pipes',
        'roles',
        'permissions',
        'public',
        'isPublic',
        'tags',
        'security',
        'excludeFromDocs',
        'onError',
        'onResponse',
        '__isController',
      ].includes(key)
    ) {
      continue
    }

    const rc = routeConfig as any
    if (!rc || !rc.method || !rc.path || !rc.handle) continue

    const routeMiddlewares = [...fileMiddleware]

    if (rc.cors) {
      routeMiddlewares.push(rc.cors === true ? cors({}) : cors(rc.cors))
    }
    const rcMiddleware = rc.middleware || rc.middlewares
    if (rcMiddleware) {
      routeMiddlewares.push(
        ...(Array.isArray(rcMiddleware) ? rcMiddleware : [rcMiddleware])
      )
    }

    const combinedFilters = [
      ...(config.filters
        ? Array.isArray(config.filters)
          ? config.filters
          : [config.filters]
        : []),
      ...(rc.filters
        ? Array.isArray(rc.filters)
          ? rc.filters
          : [rc.filters]
        : []),
    ]

    const combinedPipes = [
      ...(config.pipes
        ? Array.isArray(config.pipes)
          ? config.pipes
          : [config.pipes]
        : []),
      ...(rc.pipes ? (Array.isArray(rc.pipes) ? rc.pipes : [rc.pipes]) : []),
    ]

    // ─── SUPER HANDLER WRAPPER ───
    const superHandler = async (req: any, res: any, next: any) => {
      if (onResponse) {
        res.raw.on('finish', () => onResponse(req, res))
      }

      const isPublic =
        rc.public ?? rc.isPublic ?? config.public ?? config.isPublic ?? false

      const executionCtx = {
        req,
        res,
        next,
        app,
        isPublic,
        state: executionContext.getStore()?.state || (req as any).state || {},
        getClass: () => Object as any,
        getHandler: () => rc.handle,
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => res,
          getNext: () => next,
        }),
      }

      try {
        // Dynamic Route Timeout Override
        const routeTimeoutVal =
          rc.timeoutMs !== undefined ? rc.timeoutMs : rc.timeout
        if (
          routeTimeoutVal !== undefined &&
          typeof req.setTimeout === 'function'
        ) {
          const ms =
            typeof routeTimeoutVal === 'number'
              ? routeTimeoutVal
              : routeTimeoutVal?.ms
          if (typeof ms === 'number') {
            if (ms <= 0) req.clearTimeout?.()
            else req.setTimeout(ms)
          }
        }

        if (req.body === undefined && typeof req.json === 'function') {
          const ct = req.headers?.['content-type'] || ''
          if (
            ct.includes('application/json') ||
            ct.includes('application/x-www-form-urlencoded')
          ) {
            try {
              req.body = await req.json()
            } catch {
              // Ignore
            }
          }
        }

        // 0. Enforce Route Roles and Permissions
        if (!isPublic) {
          const isSuper = req.user?.isSuperAdmin === true

          if (rc.roles || config.roles) {
            const requiredRoles = [
              ...(config.roles
                ? Array.isArray(config.roles)
                  ? config.roles
                  : [config.roles]
                : []),
              ...(rc.roles
                ? Array.isArray(rc.roles)
                  ? rc.roles
                  : [rc.roles]
                : []),
            ]
            if (requiredRoles.length > 0 && !isSuper) {
              if (!req.user) {
                res.status(401).json({
                  success: false,
                  error: {
                    code: 'UNAUTHORIZED',
                    message: 'Unauthorized: User not found on request',
                  },
                })
                return
              }
              const userRoles = req.user.roles || req.user.role || []
              const rolesArray = Array.isArray(userRoles)
                ? userRoles
                : [userRoles]
              const hasRole = requiredRoles.some((r: string) =>
                rolesArray.includes(r)
              )
              if (!hasRole) {
                res.status(403).json({
                  success: false,
                  error: {
                    code: 'FORBIDDEN',
                    message: 'Forbidden: Insufficient roles',
                  },
                })
                return
              }
            }
          }

          if (rc.permissions || config.permissions) {
            const requiredPerms = [
              ...(config.permissions
                ? Array.isArray(config.permissions)
                  ? config.permissions
                  : [config.permissions]
                : []),
              ...(rc.permissions
                ? Array.isArray(rc.permissions)
                  ? rc.permissions
                  : [rc.permissions]
                : []),
            ]
            if (requiredPerms.length > 0 && !isSuper) {
              if (!req.user) {
                res.status(401).json({
                  success: false,
                  error: {
                    code: 'UNAUTHORIZED',
                    message: 'Unauthorized: User not found on request',
                  },
                })
                return
              }
              const userPerms =
                req.user.permissions || req.user.roles || req.user.role || []
              const permsArray = Array.isArray(userPerms)
                ? userPerms
                : [userPerms]
              const hasPerm = requiredPerms.every((p: string) =>
                permsArray.includes(p)
              )
              if (!hasPerm) {
                res.status(403).json({
                  success: false,
                  error: {
                    code: 'FORBIDDEN',
                    message: 'Forbidden: Insufficient permissions',
                  },
                })
                return
              }
            }
          }
        }

        // 1. Run Guards
        const routeGuards = [...(config.guards || []), ...(rc.guards || [])]
        for (const guard of routeGuards) {
          let guardInstance: any
          if (typeof guard === 'function' && guard.prototype?.canActivate) {
            guardInstance = app.container.resolve(guard) || new guard()
          } else if (
            typeof guard === 'object' &&
            guard !== null &&
            typeof guard.canActivate === 'function'
          ) {
            guardInstance = guard
          }

          const allowed = guardInstance
            ? await guardInstance.canActivate(executionCtx)
            : typeof guard === 'function'
              ? await guard(executionCtx)
              : true

          if (!allowed) {
            if (res && !res.headersSent) {
              res.status(403).json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Forbidden by Guard' },
              })
            }
            return
          }
        }

        // 2. Run Transformation Pipes
        if (combinedPipes.length > 0) {
          for (const pipe of combinedPipes) {
            if (
              typeof pipe === 'object' &&
              pipe !== null &&
              typeof pipe.transform !== 'function'
            ) {
              // Field-to-pipe mapping object e.g. { n: ParseIntPipe }
              for (const [field, fieldPipe] of Object.entries(pipe)) {
                let fieldPipeInst: any
                if (
                  typeof fieldPipe === 'function' &&
                  (fieldPipe as any).prototype?.transform
                ) {
                  fieldPipeInst =
                    app.container.resolve(fieldPipe as any) ||
                    new (fieldPipe as any)()
                } else if (
                  typeof fieldPipe === 'object' &&
                  fieldPipe !== null &&
                  typeof (fieldPipe as any).transform === 'function'
                ) {
                  fieldPipeInst = fieldPipe
                }

                if (fieldPipeInst) {
                  if (req.query && req.query[field] !== undefined) {
                    req.query[field] = await fieldPipeInst.transform(
                      req.query[field],
                      { type: 'query', data: field }
                    )
                  }
                  if (req.params && req.params[field] !== undefined) {
                    req.params[field] = await fieldPipeInst.transform(
                      req.params[field],
                      { type: 'param', data: field }
                    )
                  }
                  if (req.body && req.body[field] !== undefined) {
                    req.body[field] = await fieldPipeInst.transform(
                      req.body[field],
                      { type: 'body', data: field }
                    )
                  }
                }
              }
              continue
            }

            let pipeInstance: any
            if (typeof pipe === 'function' && pipe.prototype?.transform) {
              pipeInstance = app.container.resolve(pipe) || new pipe()
            } else if (
              typeof pipe === 'object' &&
              pipe !== null &&
              typeof pipe.transform === 'function'
            ) {
              pipeInstance = pipe
            }

            if (pipeInstance) {
              const runPipe = async (
                target: any,
                type: string,
                metatype: any
              ) => {
                if (target === undefined || target === null) return target
                const pipeName = pipeInstance?.constructor?.name || ''
                if (
                  typeof target === 'object' &&
                  !Array.isArray(target) &&
                  pipeName.startsWith('Parse')
                ) {
                  const copy: any = { ...target }
                  for (const [k, v] of Object.entries(target)) {
                    copy[k] = await pipeInstance.transform(v, {
                      type: type as any,
                      data: k,
                      metatype,
                    })
                  }
                  return copy
                }
                return pipeInstance.transform(target, {
                  type: type as any,
                  data: undefined,
                  metatype,
                })
              }

              if (req.body !== undefined) {
                req.body = await runPipe(req.body, 'body', rc.body)
              }
              if (req.query !== undefined) {
                req.query = await runPipe(req.query, 'query', rc.query)
              }
              if (req.params !== undefined) {
                req.params = await runPipe(req.params, 'param', rc.params)
              }
            } else if (typeof pipe === 'function') {
              if (req.body !== undefined) {
                req.body = await pipe(req.body, {
                  type: 'body',
                  data: undefined,
                  metatype: rc.body,
                })
              }
            }
          }
        }

        // Build Context
        const ctx: any = {
          body: req.body,
          query: req.query,
          params: req.params,
          headers: req.headers,
          file: (req as any).file,
          files: (req as any).files,
          fields: req.body,
          req,
          res,
          app,
          resolve: <T>(token: any): T =>
            app.resolve(token, (req as any)._diCache),
          socket: (req as any).ws,
          state: executionContext.getStore()?.state || {},
        }
        if (req.user !== undefined) ctx.user = req.user
        if ((req as any).session !== undefined) {
          ctx.session = (req as any).session
        }

        // 3. Run Interceptors wrapping the handler
        const routeInterceptors = [
          ...(config.interceptors || []),
          ...(rc.interceptors || []),
        ]

        let currentHandler = async () => rc.handle(ctx)
        for (let i = routeInterceptors.length - 1; i >= 0; i--) {
          const interceptor = routeInterceptors[i]
          const nextFn = currentHandler
          currentHandler = async () => {
            let interceptorInstance: any
            if (
              typeof interceptor === 'function' &&
              interceptor.prototype?.intercept
            ) {
              interceptorInstance =
                app.container.resolve(interceptor) || new interceptor()
            } else if (
              typeof interceptor === 'object' &&
              interceptor !== null &&
              typeof interceptor.intercept === 'function'
            ) {
              interceptorInstance = interceptor
            }

            if (interceptorInstance) {
              return interceptorInstance.intercept(executionCtx, {
                handle: nextFn,
              })
            } else if (typeof interceptor === 'function') {
              if (interceptor.length >= 2) {
                return interceptor(executionCtx, { handle: nextFn })
              } else {
                await interceptor(executionCtx, res)
                return nextFn()
              }
            }
            return nextFn()
          }
        }

        const result = await currentHandler()

        if (res && !res.headersSent) {
          if (rc.redirect) {
            const url =
              typeof rc.redirect === 'string' ? rc.redirect : rc.redirect.url
            const statusCode =
              typeof rc.redirect === 'object' ? rc.redirect.statusCode : 302
            res.redirect(url, statusCode)
            return
          }

          if (rc.headers) {
            for (const [name, val] of Object.entries(rc.headers)) {
              res.setHeader(name, val as string)
            }
          }

          if (rc.httpCode) {
            res.status(rc.httpCode)
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
              if (typeof result === 'object' && result !== null) {
                res.json(result)
              } else {
                res.send(String(result))
              }
            }
          }
        }
      } catch (err) {
        let handled = false
        for (const filter of combinedFilters) {
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
            getClass: () => Object as any,
            getHandler: () => rc.handle,
            switchToHttp: () => ({
              getRequest: () => req,
              getResponse: () => res,
              getNext: () => next,
            }),
          }

          if (typeof filter === 'function' && filter.prototype?.catch) {
            const filterInstance: any =
              app.container.resolve(filter) || new filter()
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
          if (onError) {
            try {
              await onError(err, req, res)
            } catch (hookErr) {
              next(hookErr)
            }
          } else {
            next(err) // Hands off to ExisJS global error handler (which handles HttpErrors automatically!)
          }
        }
      }
    }

    // Mount to router
    const method = rc.method.toLowerCase()

    const schema: any = {}

    const isValidatorOrPipe = (v: any) =>
      v &&
      (v.parse ||
        v.transform ||
        (typeof v === 'function' && v.prototype?.transform))

    if (rc.body) {
      schema.body = isValidatorOrPipe(rc.body) ? rc.body : tex.object(rc.body)
    }
    if (rc.query) {
      schema.query = isValidatorOrPipe(rc.query)
        ? rc.query
        : tex.object(rc.query)
    }
    if (rc.params) {
      schema.params = isValidatorOrPipe(rc.params)
        ? rc.params
        : tex.object(rc.params)
    }
    if (rc.host) {
      schema.host = rc.host
    }
    if (rc.timeoutMs !== undefined) {
      schema.timeoutMs = rc.timeoutMs
    }
    if (rc.timeout !== undefined) {
      schema.timeout = rc.timeout
    }
    if (rc.upload !== undefined) {
      schema.upload = rc.upload
    }

    // Swagger / OpenAPI schema properties
    if (rc.summary) schema.summary = rc.summary
    if (rc.description) schema.description = rc.description
    if (rc.tags || config.tags) schema.tags = rc.tags || config.tags
    if (rc.operationId) schema.operationId = rc.operationId
    if (rc.deprecated !== undefined) schema.deprecated = rc.deprecated
    if (rc.responses) schema.responses = rc.responses
    if (rc.response || rc.returns) schema.response = rc.response || rc.returns
    if (rc.security || config.security)
      schema.security = rc.security || config.security
    if (rc.excludeFromDocs || config.excludeFromDocs)
      schema.excludeFromDocs = true

    if (combinedFilters.length > 0) {
      schema.filters = combinedFilters
    }

    const combinedMetadata = {
      ...(config.metadata || {}),
      ...(rc.metadata || {}),
    }
    if (Object.keys(combinedMetadata).length > 0) {
      schema.metadata = combinedMetadata
    }

    if (Object.keys(schema).length > 0) {
      ;(router as any)[method](
        rc.path,
        ...routeMiddlewares,
        schema,
        superHandler
      )
    } else {
      ;(router as any)[method](rc.path, ...routeMiddlewares, superHandler)
    }
  }

  return router
}
