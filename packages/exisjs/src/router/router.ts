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
import { SSEStream } from '../server/sse'
import { DownloadResponse } from '../server/download'
import { fileUpload, parseSizeToBytes } from '../middleware/upload'
import { routeTimeout } from '../middleware/security'
import { cors } from '../middleware/middleware'
let fastJsonStringify: any
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  fastJsonStringify = require('fast-json-stringify')
} catch {
  // fast-json-stringify is optional
}

// ─── Validation helpers ───────────────────────────────────────────────────────
// Everything here is resolved once per route (lazily, on first request, since
// validatorCompiler may be assigned after routes are registered).

type Coercion = [key: string, kind: 'number' | 'boolean' | 'date']

// Zod keeps its definition on `_def` (v3) or `def` (v4, which also aliases
// `_def`); the kind is `typeName: 'ZodNumber'` in v3 and `type: 'number'` in v4
function zodKind(schema: any): string | undefined {
  const def = schema?._def ?? schema?.def
  const kind = def?.typeName ?? def?.type
  return typeof kind === 'string'
    ? kind.replace(/^Zod/, '').toLowerCase()
    : undefined
}

// Steps through optional/default/nullable/effects/pipe wrappers to the type
// that receives the raw input
function zodUnwrap(schema: any): any {
  let current = schema
  for (let depth = 0; depth < 8 && current; depth++) {
    const def = current._def ?? current.def
    const inner = def?.innerType ?? def?.schema ?? def?.in
    if (!inner) break
    current = inner
  }
  return current
}

/**
 * Query strings and path params always arrive as strings. For tex and Zod
 * object schemas, fields declared as number, boolean or date are converted
 * before validation, so `z.number()` works without `z.coerce` or `.transform`.
 */
function buildCoercions(validator: any): Coercion[] {
  const out: Coercion[] = []
  const raw = validator?.rawSchema
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(raw)) {
      const r = raw[k]?._raw || ''
      if (r.startsWith('number')) out.push([k, 'number'])
      else if (r.startsWith('boolean')) out.push([k, 'boolean'])
    }
    return out
  }

  const object = zodUnwrap(validator)
  if (zodKind(object) !== 'object') return out
  let shape: any
  try {
    shape = object.shape ?? (object._def ?? object.def)?.shape
    if (typeof shape === 'function') shape = shape()
  } catch {
    return out
  }
  if (!shape || typeof shape !== 'object') return out
  for (const k of Object.keys(shape)) {
    const kind = zodKind(zodUnwrap(shape[k]))
    if (kind === 'number' || kind === 'boolean' || kind === 'date') {
      out.push([k, kind])
    }
  }
  return out
}

function applyCoercions(target: any, coercions: Coercion[]): void {
  if (!target || typeof target !== 'object') return
  for (const [k, kind] of coercions) {
    const v = target[k]
    if (typeof v !== 'string') continue
    if (kind === 'number') {
      if (v.trim() !== '') {
        const n = Number(v)
        if (!isNaN(n)) target[k] = n
      }
    } else if (kind === 'date') {
      // Left as a string when unparseable so the validator reports it
      const d = new Date(v)
      if (v.trim() !== '' && !isNaN(d.getTime())) target[k] = d
    } else {
      const lower = v.toLowerCase().trim()
      if (lower === 'true' || lower === '1') target[k] = true
      else if (lower === 'false' || lower === '0') target[k] = false
    }
  }
}

function compileValidator(
  router: Router<any>,
  validator: any,
  httpPart: string
): ((val: any) => any) | null {
  if (router.validatorCompiler) {
    return router.validatorCompiler({ schema: validator, httpPart })
  }
  if (typeof validator.parse === 'function') {
    return (val) => validator.parse(val)
  }
  return null
}

async function runPipeTransform(
  validator: any,
  value: any,
  type: string
): Promise<any> {
  if (typeof validator.transform === 'function') {
    return validator.transform(value, { type, data: value })
  }
  if (typeof validator === 'function' && validator.prototype?.transform) {
    const pipe = new validator()
    return pipe.transform(value, { type, data: value })
  }
  return value
}

// ─── Router ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class Router<TRoutes extends Record<string, any> = {}> {
  private routes: Route[] = []
  private middlewares: Handler<any, any, any>[] = []
  private prefix: string
  private tree: RadixTree = new RadixTree()
  public validatorCompiler?: (req: {
    schema: any
    httpPart: string
  }) => (data: any) => any

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
        if ((h as any).handle && typeof (h as any).handle === 'function') {
          actualHandlers.push(async (req: any, res: any) => {
            const ctx = {
              body: req.body,
              query: req.query,
              params: req.params,
              headers: req.headers,
              req,
              res,
              app: req.app,
              state: req.state || {},
              resolve: req.resolve,
              file: req.file,
              files: req.files,
              fields: req.fields,
            }
            const result = await (h as any).handle(ctx)
            if (result !== undefined && !res.headersSent) {
              if (typeof result === 'object' && result !== null) {
                return res.json(result)
              } else {
                return res.send(result)
              }
            }
          })
        }
      } else if (typeof h === 'function') {
        actualHandlers.push(h as Handler)
      }
    }

    // Upload parsing and validation run directly before the final handler,
    // after the route's own middleware. Authentication therefore decides
    // first: an unauthenticated request gets 401, not a validation error
    // describing the expected payload.
    const beforeHandler: Handler<any, any, any>[] = []

    if (schema?.body) {
      const bodyValidator: any = schema.body
      let compiledBody: ((val: any) => any) | null | undefined
      beforeHandler.unshift(async (req, res, next) => {
        let body: any
        try {
          const contentType = req.header('content-type') || ''
          if (req.body !== undefined) {
            body = req.body
          } else if (
            contentType.includes('application/x-www-form-urlencoded') ||
            contentType.includes('multipart/form-data')
          ) {
            await req.formData()
            body = req.body
          } else {
            body = await req.json()
          }
          if (compiledBody === undefined) {
            compiledBody = compileValidator(this, bodyValidator, 'body')
          }
          req.body = compiledBody
            ? compiledBody(body)
            : await runPipeTransform(bodyValidator, body, 'body')
          next()
        } catch (err: any) {
          if (err && typeof err === 'object') {
            err.httpPart = 'body'
            err.received = body
            err.routePath = fullPath
            err.routeMethod = method
          }
          next(err as Error)
        }
      })
    }

    if (schema?.query) {
      const queryValidator: any = schema.query
      const queryCoercions = buildCoercions(queryValidator)
      let compiledQuery: ((val: any) => any) | null | undefined
      beforeHandler.unshift(async (req, res, next) => {
        try {
          applyCoercions(req.query, queryCoercions)
          if (compiledQuery === undefined) {
            compiledQuery = compileValidator(this, queryValidator, 'query')
          }
          req.query = (
            compiledQuery
              ? compiledQuery(req.query)
              : await runPipeTransform(queryValidator, req.query, 'query')
          ) as any
          next()
        } catch (err: any) {
          if (err && typeof err === 'object') {
            err.httpPart = 'query'
            err.received = req.query
            err.routePath = fullPath
            err.routeMethod = method
          }
          next(err as Error)
        }
      })
    }

    if (schema?.params) {
      const paramsValidator: any = schema.params
      const paramsCoercions = buildCoercions(paramsValidator)
      let compiledParams: ((val: any) => any) | null | undefined
      beforeHandler.unshift(async (req, res, next) => {
        try {
          applyCoercions(req.params, paramsCoercions)
          if (compiledParams === undefined) {
            compiledParams = compileValidator(this, paramsValidator, 'params')
          }
          req.params = (
            compiledParams
              ? compiledParams(req.params)
              : await runPipeTransform(paramsValidator, req.params, 'param')
          ) as any
          next()
        } catch (err: any) {
          if (err && typeof err === 'object') {
            err.httpPart = 'params'
            err.received = req.params
            err.routePath = fullPath
            err.routeMethod = method
          }
          next(err as Error)
        }
      })
    }

    if (schema?.upload) {
      const uploadOpts: any =
        typeof schema.upload === 'string'
          ? { field: schema.upload }
          : { ...schema.upload }
      const parsedSize =
        parseSizeToBytes(uploadOpts.maxSize) || uploadOpts.maxBytes
      if (parsedSize && (!uploadOpts.limits || !uploadOpts.limits.fileSize)) {
        uploadOpts.limits = {
          ...(uploadOpts.limits || {}),
          fileSize: parsedSize,
        }
      }
      if (
        uploadOpts.destination &&
        !uploadOpts.dest &&
        uploadOpts.destination !== 'memory' &&
        uploadOpts.destination !== 'stream'
      ) {
        uploadOpts.dest = uploadOpts.destination
      }
      if (
        uploadOpts.destination === 'memory' ||
        uploadOpts.storage === 'memory'
      ) {
        delete uploadOpts.dest
      }
      if (uploadOpts.mimeTypes && !uploadOpts.allowedMimeTypes) {
        uploadOpts.allowedMimeTypes = uploadOpts.mimeTypes
      }
      const uploadHandler = uploadOpts.field
        ? fileUpload.single(uploadOpts.field, uploadOpts)
        : uploadOpts.fields
          ? fileUpload.fields(uploadOpts.fields, uploadOpts)
          : fileUpload(uploadOpts)
      beforeHandler.unshift(uploadHandler)
    }

    if (beforeHandler.length > 0) {
      actualHandlers.splice(
        Math.max(0, actualHandlers.length - 1),
        0,
        ...beforeHandler
      )
    }

    const routeTimeoutSetting =
      schema?.timeoutMs !== undefined
        ? schema.timeoutMs
        : schema?.timeout !== undefined
          ? schema.timeout
          : undefined

    if (routeTimeoutSetting !== undefined) {
      actualHandlers.unshift(routeTimeout(routeTimeoutSetting))
    }

    if (schema?.cors) {
      actualHandlers.unshift(
        cors(typeof schema.cors === 'object' ? schema.cors : {})
      )
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
      const isExisValidator = typeof schema.response.toOpenApi === 'function'

      const stringifier =
        fastJsonStringify && (isExisValidator || !isZodLike)
          ? (() => {
              try {
                const jsonSchema = isExisValidator
                  ? schema.response.toOpenApi()
                  : schema.response
                return fastJsonStringify(jsonSchema)
              } catch {
                return JSON.stringify
              }
            })()
          : JSON.stringify

      if (isZodLike && !isExisValidator) {
        const parser = schema.response.parse.bind(schema.response)
        routeInfo._serializer = (data: unknown) => {
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
    let host: string | undefined
    if (this.tree.hasHostRoutes) {
      host =
        typeof (req as any).hostname === 'string'
          ? (req as any).hostname
          : req.header('host')?.split(':')[0]
    }

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

function isStreamLike(val: any): boolean {
  if (val === null || val === undefined || typeof val !== 'object') return false
  if (val instanceof SSEStream) return false
  return (
    typeof val.pipe === 'function' ||
    (typeof val.getReader === 'function' && typeof val.tee === 'function') ||
    (typeof val[Symbol.asyncIterator] === 'function' && !Array.isArray(val))
  )
}

function handleReturnedData(data: unknown, res: Response): void {
  if (data === undefined || data === res || res.headersSent) return
  if (data instanceof DownloadResponse) {
    res.download(data.data, data.filename, data.options)
  } else if (Buffer.isBuffer(data)) {
    // Binary payloads are sent as-is, never JSON-encoded
    res.send(data)
  } else if (isStreamLike(data)) {
    ;(res as any).sendStream(data)
  } else if (!(data instanceof SSEStream)) {
    res.json(data)
  }
}

export function runHandlers(
  handlers: Handler<any, any, any>[],
  req: Request,
  res: Response,
  done?: (err?: Error) => void,
  filters?: any[]
): void {
  if (handlers.length === 1 && (!filters || filters.length === 0)) {
    const handler = handlers[0]
    let calledNext = false
    const safeNext = (err?: Error) => {
      if (calledNext) return
      calledNext = true
      if (done) {
        if (err !== undefined) done(err)
        else done()
      }
    }

    let result: unknown
    try {
      result = handler(req, res, safeNext)
    } catch (e) {
      safeNext(e instanceof Error ? e : new Error(String(e)))
      return
    }

    if (result instanceof Promise) {
      result.then(
        (data: unknown) => {
          handleReturnedData(data, res)
        },
        (e: unknown) => {
          safeNext(e instanceof Error ? e : new Error(String(e)))
        }
      )
    } else {
      handleReturnedData(result, res)
    }
    return
  }

  let index = 0
  const total = handlers.length
  // Track whether the current handler's next() was already called
  let nextCalledForCurrentHandler = false

  // Shared safeNext — guards against double next() calls without a new closure per handler
  // Defined OUTSIDE next() to avoid allocation per iteration
  const safeNext = (err?: Error) => {
    if (nextCalledForCurrentHandler) return
    nextCalledForCurrentHandler = true
    return next(err)
  }

  const next = (err?: Error): void | Promise<void> => {
    if (err) {
      if (filters && filters.length > 0) {
        // We handle filter catching asynchronously since filters might be async
        return (async () => {
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
          done?.(err)
        })()
      }
      done?.(err)
      return
    }

    if (index >= total) {
      done?.()
      return
    }

    const handler = handlers[index++]
    nextCalledForCurrentHandler = false

    let result: unknown

    try {
      result = handler(req, res, safeNext)
    } catch (e) {
      safeNext(e instanceof Error ? e : new Error(String(e)))
      return
    }

    if (result instanceof Promise) {
      result.then(
        (data: unknown) => {
          handleReturnedData(data, res)
        },
        (e: unknown) => {
          safeNext(e instanceof Error ? e : new Error(String(e)))
        }
      )
    } else {
      handleReturnedData(result, res)
    }
  }

  next()
}
