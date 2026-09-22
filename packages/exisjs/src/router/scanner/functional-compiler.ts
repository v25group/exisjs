import { Router } from '../router'
import { cors } from '../../middleware/middleware'
import { tex } from '../../validator/index'
import { executionContext } from '../../server/context'
import type { App } from '../../server/app'

/**
 * Compiles a modern functional controller configuration object into an ExisJS Router instance.
 * Assembles middleware, route parameter / body validation, guard checking, context injection,
 * and error interception into an ultra-high performance handler pipeline.
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

    // ─── SUPER HANDLER WRAPPER ───
    const superHandler = async (req: any, res: any, next: any) => {
      if (onResponse) {
        res.raw.on('finish', () => onResponse(req, res))
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

        // 0. Enforce Route Permissions (Role Authorization)
        if (rc.permissions && rc.permissions.length > 0) {
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
          const permsArray = Array.isArray(userPerms) ? userPerms : [userPerms]
          const hasPerm = rc.permissions.every((p: string) =>
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

        // 1. Run Guards
        const routeGuards = [...(config.guards || []), ...(rc.guards || [])]
        for (const guard of routeGuards) {
          const allowed = await (typeof guard === 'function'
            ? guard.prototype?.canActivate
              ? new guard().canActivate(req)
              : guard(req)
            : guard.canActivate(req))
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

        const result = await rc.handle(ctx)

        // 2. Run Interceptors
        const routeInterceptors = [
          ...(config.interceptors || []),
          ...(rc.interceptors || []),
        ]
        for (const interceptor of routeInterceptors) {
          await (typeof interceptor === 'function'
            ? interceptor.prototype?.intercept
              ? new interceptor().intercept(req, res)
              : interceptor(req, res)
            : interceptor.intercept(req, res))
        }

        if (result !== undefined && !res.headersSent) {
          if (typeof result === 'object' && result !== null) {
            res.json(result)
          } else {
            res.send(String(result))
          }
        }
      } catch (err) {
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

    // Mount to router
    const method = rc.method.toLowerCase()

    const schema: any = {}

    const isValidatorOrPipe = (v: any) =>
      v.parse ||
      v.transform ||
      (typeof v === 'function' && v.prototype?.transform)

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
