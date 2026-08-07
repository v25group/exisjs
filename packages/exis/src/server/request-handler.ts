import type { App } from './app'
import { IncomingMessage, ServerResponse } from 'node:http'
import { ExisRequest } from './request'
import { ExisResponse } from './response'
import { executionContext } from './context'
import { runHandlers } from '../router/router'
import { notFound } from '../middleware/middleware'
import { UwsIncomingMessage, UwsServerResponse } from './uws-adapter'
import type { Handler } from '../types'

export class RequestHandler {
  private _compiledPipeline?: Handler[]

  public static activeRequests = 0

  constructor(private app: App<any>) {}

  public getCompiledPipeline(): Handler[] {
    if (this._compiledPipeline) return this._compiledPipeline
    this.app.applyBuiltins()
    this._compiledPipeline = [
      ...this.app.globalMiddleware,
      (req, res, next) => this.app.getRouter().handle(req, res, next),
      notFound,
    ]
    return this._compiledPipeline
  }

  public async fetch(
    request: globalThis.Request,
    env?: any,
    ctx?: any
  ): Promise<globalThis.Response> {
    if (!(this.app as any)._routesMounted) {
      if (typeof this.app.create === 'function') await this.app.create()
      if (typeof this.app.onStartHook === 'function')
        await this.app.onStartHook(this.app)
    }
    const { handleFetch } = await import('../adapters/fetch')
    return handleFetch(this.app, request, env, ctx)
  }

  public async inject(options: {
    method?: string
    url: string
    headers?: Record<string, string>
    body?: any
  }): Promise<import('../testing/client').TestResponse> {
    const method = (options.method || 'GET').toUpperCase()
    const url = options.url.startsWith('http')
      ? options.url
      : `http://localhost${options.url}`

    const headers = new Headers()
    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        headers.set(k, v)
      }
    }

    let bodyStr: string | undefined
    if (options.body) {
      bodyStr =
        typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body)
      if (!headers.has('content-type') && typeof options.body !== 'string') {
        headers.set('content-type', 'application/json')
      }
    }

    const req = new Request(url, {
      method,
      headers,
      body: ['GET', 'HEAD', 'OPTIONS'].includes(method) ? undefined : bodyStr,
    })

    const fetchRes = await this.fetch(req)
    const resText = await fetchRes.text()

    let parsedBody: any = resText
    try {
      parsedBody = JSON.parse(resText)
    } catch {
      // ignore
    }

    const resHeaders: Record<string, string> = {}
    fetchRes.headers.forEach((v, k) => {
      resHeaders[k] = v
    })

    return {
      status: fetchRes.status,
      headers: resHeaders,
      body: parsedBody,
      text: resText,
    }
  }

  public _executeWithContext(
    req: ExisRequest,
    res: ExisResponse,
    execution: () => void
  ): void {
    if (this.app.options.asyncContext) {
      const store: import('./context').InternalContext = {
        state: {},
        afterCallbacks: [],
        req: req as unknown as import('../types').Request,
        res: res as unknown as import('../types').Response,
        app: this.app as any,
        diCache: new Map(),
      }

      let reqCompleted = false
      const onComplete = () => {
        if (reqCompleted) return
        reqCompleted = true
        for (const cb of store.afterCallbacks) {
          try {
            const promise = cb()
            if (promise instanceof Promise) {
              promise.catch((err) => {
                this.app.log.error({ err }, 'Error in after() background task')
              })
            }
          } catch (err) {
            this.app.log.error({ err }, 'Error in after() background task')
          }
        }
        RequestHandler.activeRequests--
      }

      res.raw.on('finish', onComplete)
      res.raw.on('close', onComplete)

      executionContext.run(store, execution)
    } else {
      let reqCompleted = false
      const onComplete = () => {
        if (reqCompleted) return
        reqCompleted = true
        RequestHandler.activeRequests--
      }
      res.raw.on('finish', onComplete)
      res.raw.on('close', onComplete)

      execution()
    }
  }

  public handle(rawReq: IncomingMessage, rawRes: ServerResponse): void {
    RequestHandler.activeRequests++

    const res = new ExisResponse(rawRes)
    const req = new ExisRequest(
      rawReq,
      res,
      this.app.options.trustProxy,
      this.app.options.bodyLimit
    )
    res.req = req
    res.etagEnabled = this.app.options.etag === true
    req.log = this.app.log
    req._dataloaderFns = (this.app as any)._dataloaders

    this._executeWithContext(req, res, () => {
      if (
        this.app.hooks.request.length === 0 &&
        this.app.hooks.response.length === 0
      ) {
        runHandlers(this.getCompiledPipeline(), req, res, (err) => {
          if (err) {
            this._runErrorHandlers(err, req, res).catch((e) => {
              this.app.log.error(
                { err: e, originalError: err },
                'Error in error handler'
              )
            })
          }
        })
        return
      }

      this._handleWithHooks(req, res, rawRes)
    })
  }

  public handleUws(
    shimReq: UwsIncomingMessage,
    shimRes: UwsServerResponse
  ): void {
    const res = new ExisResponse(shimRes as unknown as ServerResponse)
    const req = new ExisRequest(
      shimReq as unknown as IncomingMessage,
      res,
      this.app.options.trustProxy,
      this.app.options.bodyLimit
    )
    res.req = req
    res.etagEnabled = this.app.options.etag === true
    req.log = this.app.log
    req._dataloaderFns = (this.app as any)._dataloaders

    this._executeWithContext(req, res, () => {
      if (
        this.app.hooks.request.length === 0 &&
        this.app.hooks.response.length === 0
      ) {
        runHandlers(this.getCompiledPipeline(), req, res, (err) => {
          if (err) {
            this._runErrorHandlers(err, req, res).catch((e) => {
              this.app.log.error(
                { err: e, originalError: err },
                'Error in error handler'
              )
            })
          }
        })
        return
      }

      this._handleWithHooks(req, res, shimRes as unknown as ServerResponse)
    })
  }

  private async _handleWithHooks(
    req: ExisRequest,
    res: ExisResponse,
    rawRes: ServerResponse
  ) {
    try {
      for (const hook of this.app.hooks.request) {
        await hook(
          req as unknown as import('../types').Request,
          res as unknown as import('../types').Response
        )
        if (res.headersSent || rawRes.headersSent || res.raw.writableEnded) {
          return
        }
      }

      await new Promise<void>((resolve, reject) => {
        runHandlers(this.getCompiledPipeline(), req, res, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })

      for (const hook of this.app.hooks.response) {
        await hook(
          req as unknown as import('../types').Request,
          res as unknown as import('../types').Response
        )
      }
    } catch (err: any) {
      this._runErrorHandlers(err, req, res).catch((e) => {
        this.app.log.error(
          { err: e, originalError: err },
          'Error in error handler'
        )
      })
    }
  }

  private async _runErrorHandlers(
    err: any,
    req: ExisRequest,
    res: ExisResponse
  ) {
    for (const hook of this.app.hooks.error) {
      await hook(
        err,
        req as unknown as import('../types').Request,
        res as unknown as import('../types').Response
      )
    }

    const handlers = this.app.getErrorHandlers()
    for (const handler of handlers) {
      let handled = false
      await handler(err, req as any, res as any, () => {
        handled = true
      })
      if (!handled || res.headersSent) return
    }

    const { createErrorHandler } = await import('../utils/errors')
    const defaultHandler = createErrorHandler(
      this.app.options.env === 'development'
    )
    await defaultHandler(err, req as any, res as any, () => {
      /* noop */
    })
  }
}
