import { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { ExisRequest } from './request'
import { ExisResponse } from './response'
import { runHandlers } from '../router/router'
import { ExisWebSocket } from '../websocket/socket'
import type { Handler, Request } from '../types'
import type { App } from './app'

export class WsOrchestrator {
  private app: App<any>

  constructor(app: App<any>) {
    this.app = app
  }

  // --- Node.js WebSocket Upgrade Handler --------------------------------------

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
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
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
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
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

  // --- Bun WebSocket Upgrade Handler ------------------------------------------

  public async handleBunUpgrade(
    bunReq: any,
    resolve: (res: any) => void,
    server: any
  ): Promise<void> {
    this.app.applyBuiltins()

    const urlObj = new URL(bunReq.url)
    const reqPath = urlObj.pathname
    const matched = this.app.getRouter().match('WS', reqPath)

    if (!matched) {
      resolve(new Response('Not Found', { status: 404 }))
      return
    }

    // We create an ExisRequest/ExisResponse pipeline using mock Node APIs
    // But since this is purely for middleware execution, we can use an empty object
    // Or we could reuse BunIncomingMessage / BunServerResponse if we wanted
    // For now, we will construct a mock for middleware execution

    const reqMock = {
      method: 'WS',
      url: bunReq.url,
      headers: {},
      params: matched.params,
      log: this.app.log,
    }

    bunReq.headers.forEach((v: string, k: string) => {
      ;(reqMock.headers as any)[k] = v
    })

    let responseSent = false
    let responseStatus = 200
    let responseBody = ''

    const resMock = {
      headersSent: false,
      statusCode: 200,
      status(code: number) {
        this.statusCode = code
        return this
      },
      send(body: string) {
        responseSent = true
        responseBody = body
        responseStatus = this.statusCode
      },
      json(body: any) {
        this.send(JSON.stringify(body))
      },
    }

    const pipeline: Handler[] = [
      ...this.app.globalMiddleware,
      async (req, res, next) => {
        const routeHandlers = matched.route.handlers.slice(0, -1)
        runHandlers(routeHandlers, req as any, res as any, (err) => {
          if (err) return next(err)
          next()
        })
      },
    ]

    await runHandlers(pipeline, reqMock as any, resMock as any, async (err) => {
      if (err) {
        this.app.log.error(
          { err },
          'Error during Bun WebSocket upgrade middleware'
        )
        resolve(new Response('Internal Server Error', { status: 500 }))
        return
      }

      if (responseSent || resMock.headersSent) {
        resolve(new Response(responseBody, { status: responseStatus }))
        return
      }

      // Upgrade to WebSocket
      const exisWs = new ExisWebSocket(
        null as any,
        reqMock as any,
        this.app.wsServer
      )

      const success = server.upgrade(bunReq, {
        data: {
          exisWs,
        },
      })

      if (success) {
        this.app.wsServer.track(exisWs)
        ;(reqMock as any).ws = exisWs

        const finalHandler =
          matched.route.handlers[matched.route.handlers.length - 1]
        Promise.resolve(
          finalHandler(reqMock as any, resMock as any, () => {
            /* noop */
          })
        ).catch((err) => {
          this.app.log.error({ err }, 'Error in Bun WebSocket handler')
        })

        return
      }

      resolve(new Response('WebSocket upgrade failed', { status: 400 }))
    })
  }
}
