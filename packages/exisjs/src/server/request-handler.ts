import type { App } from './app'
import http, { IncomingMessage, ServerResponse } from 'node:http'
import { ExisRequest } from './request'
import { ExisResponse } from './response'
import { executionContext, cleanupContext } from './context'
import { runHandlers } from '../router/router'
import { notFound } from '../middleware/middleware'
import type { Handler } from '../types'

export class RequestHandler {
  private _compiledPipeline?: Handler[]
  public static activeRequests = 0

  // ─── Object Pools ───────────────────────────────────────────────────────────
  // Recycle ExisRequest and ExisResponse objects instead of allocating new ones
  // per request. This dramatically reduces V8 GC pressure under high load.
  private _reqPool: ExisRequest[] = []
  private _resPool: ExisResponse[] = []
  private static readonly MAX_POOL_SIZE = 2048

  constructor(private app: App<any>) {}

  private _acquireReq(
    rawReq: IncomingMessage,
    res: ExisResponse,
    trustProxy: boolean | number,
    bodyLimit: number
  ): ExisRequest {
    const pooled = this._reqPool.pop()
    if (pooled) {
      return pooled.init(rawReq, res, trustProxy, bodyLimit)
    }
    return new ExisRequest(rawReq, res, trustProxy, bodyLimit)
  }

  private _acquireRes(rawRes: ServerResponse): ExisResponse {
    const pooled = this._resPool.pop()
    if (pooled) {
      return pooled.init(rawRes)
    }
    return new ExisResponse(rawRes)
  }

  private _releaseReq(req: ExisRequest): void {
    req.cleanup()
    if (this._reqPool.length < RequestHandler.MAX_POOL_SIZE) {
      this._reqPool.push(req)
    }
  }

  private _releaseRes(res: ExisResponse): void {
    res.req = undefined as any
    if (this._resPool.length < RequestHandler.MAX_POOL_SIZE) {
      this._resPool.push(res)
    }
  }

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

  public async inject(options: {
    method?: string
    url: string
    headers?: Record<string, string>
    body?: any
    payload?: any
  }): Promise<import('../testing/client').TestResponse> {
    if (!(this.app as any)._routesMounted) {
      if (typeof this.app.create === 'function') await this.app.create()
      if (typeof this.app.onStartHook === 'function')
        await this.app.onStartHook(this.app)
    }

    const method = (options.method || 'GET').toUpperCase()
    const path = options.url
    const payload = options.body !== undefined ? options.body : options.payload

    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.app.handle(req, res)
      })

      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as import('node:net').AddressInfo
        const port = address.port

        const headers: Record<string, string> = {}
        if (options.headers) {
          for (const [k, v] of Object.entries(options.headers)) {
            headers[k.toLowerCase()] = v
          }
        }

        let bodyStr: string | undefined

        if (payload && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
          bodyStr =
            typeof payload === 'string' ? payload : JSON.stringify(payload)
          if (typeof payload === 'object' && !headers['content-type']) {
            headers['content-type'] = 'application/json'
          }
          headers['content-length'] = Buffer.byteLength(bodyStr).toString()
        }

        const reqOpts: import('node:http').RequestOptions = {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers,
        }

        const req = http.request(reqOpts, (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => {
            const bodyBuffer = Buffer.concat(chunks)
            const text = bodyBuffer.toString('utf8')
            let parsedBody: any = text
            try {
              if (text) parsedBody = JSON.parse(text)
            } catch {
              // Ignore
            }

            const resHeaders: Record<string, string> = {}
            for (const k in res.headers) {
              const val = res.headers[k]
              if (val) resHeaders[k] = Array.isArray(val) ? val.join(',') : val
            }

            server.close(() => {
              resolve({
                status: res.statusCode || 200,
                headers: resHeaders,
                body: parsedBody,
                text,
              })
            })
          })
        })

        req.on('error', (err) => {
          server.close(() => reject(err))
        })

        if (bodyStr) {
          req.write(bodyStr)
        }
        req.end()
      })
    })
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

      const doCleanup = () => {
        cleanupContext(store, this.app.log)
      }

      res._onFinish.push(doCleanup)
      res.raw.once('close', doCleanup)

      try {
        executionContext.run(store, execution)
      } catch (err) {
        doCleanup()
        throw err
      }
    } else {
      execution()
    }
  }

  public handle(rawReq: IncomingMessage, rawRes: ServerResponse): void {
    RequestHandler.activeRequests++
    let decremented = false
    const decrementActive = () => {
      if (!decremented) {
        decremented = true
        if (RequestHandler.activeRequests > 0) {
          RequestHandler.activeRequests--
        }
      }
    }

    const res = this._acquireRes(rawRes)
    const req = this._acquireReq(
      rawReq,
      res,
      this.app.options.trustProxy,
      this.app.options.bodyLimit
    )

    res.req = req
    res.etagEnabled = this.app.options.etag === true
    req.log = this.app.log

    // Recycle objects back to pool and decrement active request counter when the response is fully done
    rawRes.on('close', () => {
      decrementActive()
      this._releaseReq(req)
      this._releaseRes(res)
    })
    rawRes.on('finish', decrementActive)

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
      const hookResult = await hook(
        err,
        req as unknown as import('../types').Request,
        res as unknown as import('../types').Response
      )
      if (res.headersSent) return
      if (hookResult !== undefined) {
        if (typeof hookResult === 'object' && hookResult !== null) {
          ;(res as any).json(hookResult)
        } else {
          ;(res as any).send(String(hookResult))
        }
        return
      }
    }

    const handlers = this.app.getErrorHandlers()
    for (const handler of handlers) {
      let handled = false
      await handler(err, req as any, res as any, () => {
        handled = true
      })
      if (!handled || res.headersSent) return
    }

    const { createErrorHandler } = await import('../error/errors')
    const defaultHandler = createErrorHandler(
      this.app.options.env === 'development'
    )
    await defaultHandler(err, req as any, res as any, () => {
      /* noop */
    })
  }
}
