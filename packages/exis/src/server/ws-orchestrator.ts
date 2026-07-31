import { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { ExisRequest } from './request'
import { ExisResponse } from './response'
import { runHandlers } from '../router/router'
import { ExisWebSocket } from '../websocket/socket'
import type { Handler, Request } from '../types'
import { UwsServerResponse, type UwsIncomingMessage } from './uws-adapter'
import type { App } from './app'

export class WsOrchestrator {
  private app: App<any>

  constructor(app: App<any>) {
    this.app = app
  }

  // ─── WebSocket Upgrade Handler ───────────────────────────────────────────────

  public async handleUpgrade(
    rawReq: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): Promise<void> {
    this.app.applyBuiltins()

    // Match route
    const reqPath = (rawReq.url || '').split('?')[0]
    const matched = this.app.getRouter().match('WS', reqPath)
    if (!matched) {
      socket.write('HTTP/1.1 404 Not Found\\r\\n\\r\\n')
      socket.destroy()
      return
    }

    // Create a dummy ServerResponse so standard HTTP middleware can run and reject if needed
    const rawRes = new ServerResponse(rawReq)
    rawRes.assignSocket(socket as unknown as import('node:net').Socket)
    const res = new ExisResponse(rawRes)
    const originalMethod = rawReq.method
    const req = new ExisRequest(
      rawReq,
      res,
      this.app.options.trustProxy,
      this.app.options.bodyLimit
    )
    res.req = req
    req.method = 'WS'
    req.params = matched.params
    req.log = this.app.log

    // Build the middleware pipeline specifically for this WebSocket route
    const pipeline: Handler[] = [
      ...this.app.globalMiddleware,
      async (req, res, next) => {
        // Exclude the last handler which is the actual WsHandler wrapper
        const routeHandlers = matched.route.handlers.slice(0, -1)
        runHandlers(routeHandlers, req, res, (err) => {
          if (err) return next(err)
          next()
        })
      },
    ]

    await runHandlers(pipeline, req, res, async (err) => {
      if (err) {
        this.app.log.error({ err }, 'Error during WebSocket upgrade middleware')
        socket.write('HTTP/1.1 500 Internal Server Error\\r\\n\\r\\n')
        socket.destroy()
        return
      }

      if (res.headersSent) {
        // A middleware intercepted and sent an HTTP response (e.g. 401 Unauthorized)
        socket.destroy()
        return
      }

      // Restore original HTTP method (usually 'GET') so the `ws` package doesn't reject with 405
      rawReq.method = originalMethod

      // Middleware passed, perform upgrade
      this.app.rawWsServer.handleUpgrade(rawReq, socket, head, (ws) => {
        const exisWs = new ExisWebSocket(ws, req, this.app.wsServer)
        this.app.wsServer.track(exisWs)
        // Attach to request so the wrapped ws() handler in Router can extract it
        ;(req as Request & { ws?: ExisWebSocket }).ws = exisWs

        const finalHandler =
          matched.route.handlers[matched.route.handlers.length - 1]
        Promise.resolve(
          finalHandler(req, res, () => {
            /* noop */
          })
        ).catch((err) => {
          this.app.log.error({ err }, 'Error in WebSocket handler')
          ws.close(1011, 'Internal Server Error')
        })
      })
    })
  }

  /**
   * WebSocket Upgrade Handler for uWebSockets.js
   * Runs the middleware pipeline and if successful, upgrades the connection.
   */
  public async handleUwsUpgrade(
    shimReq: UwsIncomingMessage,
    uwsRes: any,
    context: any
  ): Promise<void> {
    this.app.applyBuiltins()

    const reqPath = (shimReq.url || '').split('?')[0]
    const matched = this.app.getRouter().match('WS', reqPath)

    if (!matched) {
      // 404
      uwsRes.cork(() => {
        uwsRes.writeStatus('404 Not Found')
        uwsRes.end()
      })
      return
    }

    let isAborted = false
    uwsRes.onAborted(() => {
      isAborted = true
    })

    const shimRes = new UwsServerResponse(uwsRes)
    const res = new ExisResponse(shimRes as unknown as ServerResponse)
    const req = new ExisRequest(
      shimReq as unknown as IncomingMessage,
      res,
      this.app.options.trustProxy,
      this.app.options.bodyLimit
    )
    res.req = req
    req.method = 'WS'
    req.params = matched.params
    req.log = this.app.log

    const pipeline: Handler[] = [
      ...this.app.globalMiddleware,
      async (req, res, next) => {
        const routeHandlers = matched.route.handlers.slice(0, -1)
        runHandlers(routeHandlers, req, res, (err) => {
          if (err) return next(err)
          next()
        })
      },
    ]

    this.app.requestHandler._executeWithContext(req, res, async () => {
      runHandlers(pipeline, req, res, async (err) => {
        if (isAborted) return

        if (err) {
          this.app.log.error(
            { err },
            'Error during uWS WebSocket upgrade middleware'
          )
          uwsRes.cork(() => {
            uwsRes.writeStatus('500 Internal Server Error')
            uwsRes.end()
          })
          return
        }

        if (res.headersSent) {
          return // Middleware sent an HTTP response
        }

        // We need to fetch headers directly from the shimReq.headers
        const secWebSocketKey = shimReq.headers['sec-websocket-key'] || ''
        const secWebSocketProtocol =
          shimReq.headers['sec-websocket-protocol'] || ''
        const secWebSocketExtensions =
          shimReq.headers['sec-websocket-extensions'] || ''

        // Prepare user data for the upgraded websocket
        const userData = {
          req,
          res,
          exisWs: new ExisWebSocket(null as any, req, this.app.wsServer), // the raw will be set to shim in open()
          finalHandler:
            matched.route.handlers[matched.route.handlers.length - 1],
        }

        this.app.wsServer.track(userData.exisWs)
        // Attach to request
        ;(req as Request & { ws?: ExisWebSocket }).ws = userData.exisWs

        uwsRes.cork(() => {
          uwsRes.upgrade(
            userData,
            secWebSocketKey,
            secWebSocketProtocol,
            secWebSocketExtensions,
            context
          )
        })

        Promise.resolve(
          userData.finalHandler(req, res, () => {
            /* noop */
          })
        ).catch((e) => {
          this.app.log.error({ err: e }, 'Error in uWS WebSocket handler')
        })
      })
    })
  }
}
