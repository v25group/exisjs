import type {
  Handler,
  HttpMethod,
  Route,
  RouteHandler,
  RouteSchema,
  RouteMatch,
  Request,
  Response,
} from '../types'

import { RadixTree } from './radix'

let fastJsonStringify: any
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  fastJsonStringify = require('fast-json-stringify')
} catch {
  // fast-json-stringify is optional
}

// ─── Router ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class Router<TRoutes extends Record<string, any> = {}> {
  private routes: Route[] = []
  private middlewares: Handler<any, any, any>[] = []
  private prefix: string
  private tree: RadixTree = new RadixTree()

  constructor(prefix = '') {
    this.prefix = prefix
  }

  getRoutes(): Route[] {
    return this.routes
  }

  private rebuildTree() {
    this.tree = new RadixTree()
    for (const route of this.routes) {
      this.tree.insert(route.method, route.path, route)
    }
  }

  // ─── Middleware ─────────────────────────────────────────────────────────────

  use(...handlers: Handler<any, any, any>[]): this {
    this.middlewares.push(...handlers)
    return this
  }

  // ─── Route Registration ──────────────────────────────────────────────────────

  private addRoute(
    method: HttpMethod,
    path: string,
    handlers: RouteHandler<any, any, any, any>[]
  ): this {
    let fullPath = (this.prefix + path).replace(/\/+/g, '/')
    if (fullPath.length > 1 && fullPath.endsWith('/')) {
      fullPath = fullPath.slice(0, -1)
    }

    let schema: RouteSchema<any, any, any, any> | undefined
    const actualHandlers: Handler<any, any, any>[] = []

    for (const h of handlers) {
      if (typeof h === 'object' && h !== null && !Array.isArray(h)) {
        schema = h as RouteSchema
      } else if (typeof h === 'function') {
        actualHandlers.push(h as Handler)
      }
    }

    if (schema?.body) {
      const bodyValidator = schema.body
      actualHandlers.unshift(async (req, res, next) => {
        try {
          let body
          const contentType = req.header('content-type') || ''
          if (
            contentType.includes('application/x-www-form-urlencoded') ||
            contentType.includes('multipart/form-data')
          ) {
            await req.formData()
            body = req.body
          } else {
            body = await req.json()
          }
          if (typeof bodyValidator.parse === 'function') {
            req.body = bodyValidator.parse(body)
          } else if (typeof bodyValidator.transform === 'function') {
            req.body = await bodyValidator.transform(body, {
              type: 'body',
              data: body,
            })
          } else if (
            typeof bodyValidator === 'function' &&
            bodyValidator.prototype?.transform
          ) {
            const pipe = new bodyValidator()
            req.body = await pipe.transform(body, { type: 'body', data: body })
          }
          next()
        } catch (err) {
          next(err as Error)
        }
      })
    }

    if (schema?.query) {
      const queryValidator = schema.query
      actualHandlers.unshift(async (req, res, next) => {
        try {
          if (typeof queryValidator.parse === 'function') {
            req.query = queryValidator.parse(req.query) as Record<
              string,
              string
            >
          } else if (typeof queryValidator.transform === 'function') {
            req.query = (await queryValidator.transform(req.query, {
              type: 'query',
              data: req.query,
            })) as any
          } else if (
            typeof queryValidator === 'function' &&
            queryValidator.prototype?.transform
          ) {
            const pipe = new queryValidator()
            req.query = (await pipe.transform(req.query, {
              type: 'query',
              data: req.query,
            })) as any
          }
          next()
        } catch (err) {
          next(err as Error)
        }
      })
    }

    if (schema?.params) {
      const paramsValidator = schema.params
      // Params validation runs as middleware AFTER the router sets req.params
      // So we push it (not unshift) to run after route matching populates params
      actualHandlers.unshift(async (req, res, next) => {
        try {
          if (typeof paramsValidator.parse === 'function') {
            req.params = paramsValidator.parse(req.params) as Record<
              string,
              string
            >
          } else if (typeof paramsValidator.transform === 'function') {
            req.params = (await paramsValidator.transform(req.params, {
              type: 'param',
              data: req.params,
            })) as any
          } else if (
            typeof paramsValidator === 'function' &&
            paramsValidator.prototype?.transform
          ) {
            const pipe = new paramsValidator()
            req.params = (await pipe.transform(req.params, {
              type: 'param',
              data: req.params,
            })) as any
          }
          next()
        } catch (err) {
          next(err as Error)
        }
      })
    }

    const routeInfo: Route = {
      method,
      path: fullPath,
      handlers: [...this.middlewares, ...actualHandlers],
      schema,
      host: schema?.host,
    }

    if (schema?.response) {
      const isZodLike = typeof schema.response.parse === 'function'
      const stringifier =
        fastJsonStringify && !isZodLike
          ? (() => {
              try {
                return fastJsonStringify(schema.response)
              } catch {
                return JSON.stringify
              }
            })()
          : JSON.stringify

      if (isZodLike) {
        const parser = schema.response.parse.bind(schema.response)
        routeInfo._serializer = (data: unknown) => {
          console.log('[Router] _serializer received data:', data)
          return stringifier(parser(data))
        }
      } else if (stringifier !== JSON.stringify) {
        routeInfo._serializer = stringifier
      }
    }

    this.routes.push(routeInfo)
    this.tree.insert(method, fullPath, routeInfo)

    return this
  }

  get<Path extends string, Schema extends RouteSchema<any, any, any, any>>(
    path: Path,
    ...handlers:
      | [...Handler<any, any, any>[], Schema, Handler<any, any, any>]
      | RouteHandler<any, any, any, any>[]
  ): Router<TRoutes & { get: Record<Path, Schema> }> {
    this.addRoute('GET', path, handlers as any)
    return this as any
  }

  post<Path extends string, Schema extends RouteSchema<any, any, any, any>>(
    path: Path,
    ...handlers:
      | [...Handler<any, any, any>[], Schema, Handler<any, any, any>]
      | RouteHandler<any, any, any, any>[]
  ): Router<TRoutes & { post: Record<Path, Schema> }> {
    this.addRoute('POST', path, handlers as any)
    return this as any
  }

  put<Path extends string, Schema extends RouteSchema<any, any, any, any>>(
    path: Path,
    ...handlers:
      | [...Handler<any, any, any>[], Schema, Handler<any, any, any>]
      | RouteHandler<any, any, any, any>[]
  ): Router<TRoutes & { put: Record<Path, Schema> }> {
    this.addRoute('PUT', path, handlers as any)
    return this as any
  }

  patch<Path extends string, Schema extends RouteSchema<any, any, any, any>>(
    path: Path,
    ...handlers:
      | [...Handler<any, any, any>[], Schema, Handler<any, any, any>]
      | RouteHandler<any, any, any, any>[]
  ): Router<TRoutes & { patch: Record<Path, Schema> }> {
    this.addRoute('PATCH', path, handlers as any)
    return this as any
  }

  delete<Path extends string, Schema extends RouteSchema<any, any, any, any>>(
    path: Path,
    ...handlers:
      | [...Handler<any, any, any>[], Schema, Handler<any, any, any>]
      | RouteHandler<any, any, any, any>[]
  ): Router<TRoutes & { delete: Record<Path, Schema> }> {
    this.addRoute('DELETE', path, handlers as any)
    return this as any
  }

  options<Path extends string, Schema extends RouteSchema<any, any, any, any>>(
    path: Path,
    ...handlers:
      | [...Handler<any, any, any>[], Schema, Handler<any, any, any>]
      | RouteHandler<any, any, any, any>[]
  ): Router<TRoutes & { options: Record<Path, Schema> }> {
    this.addRoute('OPTIONS', path, handlers as any)
    return this as any
  }

  head<Path extends string, Schema extends RouteSchema<any, any, any, any>>(
    path: Path,
    ...handlers:
      | [...Handler<any, any, any>[], Schema, Handler<any, any, any>]
      | RouteHandler<any, any, any, any>[]
  ): Router<TRoutes & { head: Record<Path, Schema> }> {
    this.addRoute('HEAD', path, handlers as any)
    return this as any
  }

  connect<Path extends string, Schema extends RouteSchema<any, any, any, any>>(
    path: Path,
    ...handlers:
      | [...Handler<any, any, any>[], Schema, Handler<any, any, any>]
      | RouteHandler<any, any, any, any>[]
  ): Router<TRoutes & { connect: Record<Path, Schema> }> {
    this.addRoute('CONNECT', path, handlers as any)
    return this as any
  }

  trace<Path extends string, Schema extends RouteSchema<any, any, any, any>>(
    path: Path,
    ...handlers:
      | [...Handler<any, any, any>[], Schema, Handler<any, any, any>]
      | RouteHandler<any, any, any, any>[]
  ): Router<TRoutes & { trace: Record<Path, Schema> }> {
    this.addRoute('TRACE', path, handlers as any)
    return this as any
  }

  query<Path extends string, Schema extends RouteSchema<any, any, any, any>>(
    path: Path,
    ...handlers:
      | [...Handler<any, any, any>[], Schema, Handler<any, any, any>]
      | RouteHandler<any, any, any, any>[]
  ): Router<TRoutes & { query: Record<Path, Schema> }> {
    this.addRoute('QUERY', path, handlers as any)
    return this as any
  }

  ws<Path extends string>(
    path: Path,
    ...handlers: (Handler<any, any, any> | import('../types').WsHandler)[]
  ): Router<TRoutes & { ws: Record<Path, any> }> {
    const wsHandler = handlers.pop() as import('../types').WsHandler
    const wrapped: Handler = (req, res, next) => {
      const socket = (req as import('../types').Request & { ws?: unknown }).ws
      if (socket) {
        // If the handler is superHandler from app.ts, it expects (req, res, next)
        if (wsHandler.length === 3) {
          ;(wsHandler as any)(req, res, next)
        } else {
          wsHandler(socket as import('../websocket/socket').ExisWebSocket, req)
        }
      } else {
        next()
      }
    }
    handlers.push(wrapped)
    return this.addRoute('WS', path, handlers as RouteHandler[])
  }

  sse<Path extends string>(
    path: Path,
    ...handlers: (Handler<any, any, any> | import('../types').SseHandler)[]
  ): Router<TRoutes & { sse: Record<Path, any> }> {
    const sseHandler = handlers.pop() as import('../types').SseHandler
    const wrappedHandler: RouteHandler = async (req, res) => {
      // 1. Create the SSE wrapper which sends the correct HTTP headers and maintains state
      const ExisSSE = (await import('../server/sse')).ExisSSE
      const sse = new ExisSSE(res)

      // 2. Execute the user's handler
      await sseHandler(sse, req)
    }
    handlers.push(wrappedHandler)
    return this.addRoute('GET', path, handlers as RouteHandler[])
  }

  all<Path extends string, Schema extends RouteSchema<any, any, any, any>>(
    path: Path,
    ...handlers:
      | [...Handler<any, any, any>[], Schema, Handler<any, any, any>]
      | RouteHandler<any, any, any, any>[]
  ): Router<TRoutes & { all: Record<Path, Schema> }> {
    this.addRoute('ALL', path, handlers as any)
    return this as any
  }

  // ─── Route Groups ─────────────────────────────────────────────────────────────

  group(prefix: string, callback: (router: Router) => void): this {
    const nested = new Router(this.prefix + prefix)
    // inherit parent middlewares into group
    nested.middlewares = [...this.middlewares]
    callback(nested)

    for (const r of nested.getRoutes()) {
      this.routes.push(r)
      this.tree.insert(r.method, r.path, r)
    }

    return this
  }

  // ─── Match ────────────────────────────────────────────────────────────────────

  match(method: string, path: string, host?: string): RouteMatch | null {
    return this.tree.search(method, path, host)
  }

  // ─── Handler Execution ────────────────────────────────────────────────────────

  handle(
    req: Request,
    res: Response,
    fallthrough?: (err?: Error) => void
  ): void {
    const host =
      typeof (req as any).hostname === 'string'
        ? (req as any).hostname
        : req.header('host')?.split(':')[0]

    const matched = this.match(req.method, req.path, host)

    if (!matched) {
      if (fallthrough) fallthrough()
      return
    }

    req.params = matched.params

    // Attach pre-compiled serializer to response for fast JSON output
    if (matched.route._serializer) {
      res._serializer = matched.route._serializer
    }

    if (fallthrough) {
      runHandlers(
        matched.route.handlers,
        req,
        res,
        fallthrough,
        matched.route.schema?.filters
      )
    } else {
      runHandlers(
        matched.route.handlers,
        req,
        res,
        undefined,
        matched.route.schema?.filters
      )
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────────

  addRawRoute(route: Route): void {
    this.routes.push(route)
    this.tree.insert(route.method, route.path, route)
  }

  getMiddlewares(): Handler[] {
    return this.middlewares
  }

  removeRoutesBySource(sourceFile: string): number {
    const before = this.routes.length
    this.routes = this.routes.filter((r) => r.sourceFile !== sourceFile)
    const removedCount = before - this.routes.length
    if (removedCount > 0) {
      this.rebuildTree()
    }
    return removedCount
  }
}

export function runHandlers(
  handlers: Handler<any, any, any>[],
  req: Request,
  res: Response,
  done?: (err?: Error) => void,
  filters?: any[]
): void {
  let index = 0
  const total = handlers.length

  const next = async (err?: Error): Promise<void> => {
    if (err) {
      if (filters && filters.length > 0) {
        for (const filter of filters) {
          try {
            if (typeof filter === 'function' && filter.prototype?.catch) {
              const filterInstance = new filter()
              await filterInstance.catch(err, { req, res })
              return
            } else if (
              typeof filter === 'object' &&
              typeof filter.catch === 'function'
            ) {
              await filter.catch(err, { req, res })
              return
            }
          } catch {
            // Ignore filter errors and continue to next or fallback
          }
        }
      }
      done?.(err)
      return
    }

    if (index >= total) {
      done?.()
      return
    }

    const handler = handlers[index++]

    let result: unknown
    try {
      result = handler(req, res, next)
      if (result instanceof Promise) {
        result.catch((e) => {
          next(e instanceof Error ? e : new Error(String(e)))
        })
      }
    } catch (e) {
      next(e instanceof Error ? e : new Error(String(e)))
      return
    }

    if (result instanceof Promise) {
      result.then(
        (data: unknown) => {
          if (data !== undefined && data !== res && !res.headersSent) {
            res.json(data)
          }
        },
        (e: unknown) => {
          next(e instanceof Error ? e : new Error(String(e)))
        }
      )
    } else if (result !== undefined && result !== res && !res.headersSent) {
      res.json(result)
    }
  }

  next()
}
