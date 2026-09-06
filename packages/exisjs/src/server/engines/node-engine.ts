import { createServer as createHttpServer } from 'node:http'
import type { Server as HttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { Server as HttpsServer } from 'node:https'
import { createSecureServer as createHttp2Server } from 'node:http2'
import type { Http2SecureServer } from 'node:http2'
import type { HttpEngine } from './engine'
import type { App } from '../app'
import type { ListenOptions } from '../../types'

export class NodeEngine implements HttpEngine {
  public readonly name = 'node'
  private server!: HttpServer | HttpsServer | Http2SecureServer
  public redirectServer: HttpServer | null = null

  constructor(private app: App<any>) {}

  private _initServer(): HttpServer | HttpsServer | Http2SecureServer {
    let server: HttpServer | HttpsServer | Http2SecureServer

    if (this.app.options.ssl) {
      if (this.app.options.http2 !== false) {
        server = createHttp2Server(
          { allowHTTP1: true, ...this.app.options.ssl },
          this.app.handle.bind(this.app) as unknown as (
            req: unknown,
            res: unknown
          ) => void
        )
      } else {
        server = createHttpsServer(
          this.app.options.ssl,
          this.app.handle.bind(this.app)
        )
      }
    } else {
      server = createHttpServer(this.app.handle.bind(this.app))
    }

    const keepAlive = this.app.options.keepAlive
    if (keepAlive) {
      const kaConfig = keepAlive === true ? {} : keepAlive
      if ('keepAliveTimeout' in server)
        server.keepAliveTimeout = kaConfig.timeoutMs ?? 5000
      if ('headersTimeout' in server)
        server.headersTimeout = kaConfig.headersTimeoutMs ?? 60000
      if (
        kaConfig.maxRequests !== undefined &&
        'maxRequestsPerSocket' in server
      ) {
        ;(
          server as unknown as { maxRequestsPerSocket: number }
        ).maxRequestsPerSocket = kaConfig.maxRequests
      }
    }

    return server
  }

  listen(
    port: number,
    host: string,
    options: ListenOptions,
    onListen: (address: { port: number; host: string }) => void
  ): HttpServer | HttpsServer | Http2SecureServer {
    // Re-initialize server if ssl is passed during listen
    if (options.ssl) {
      this.app.options.ssl = options.ssl
    }
    if (options.redirectHttp !== undefined) {
      this.app.options.redirectHttp = options.redirectHttp
    }
    this.server = this._initServer()

    if (
      this.app.options.ssl &&
      this.app.options.redirectHttp !== undefined &&
      this.app.options.redirectHttp !== false
    ) {
      const redirectPort =
        typeof this.app.options.redirectHttp === 'number'
          ? this.app.options.redirectHttp
          : 80
      this.redirectServer = createHttpServer((req, res) => {
        const targetHost = req.headers.host?.split(':')[0] || host
        const actualPort =
          port === 0
            ? (this.server.address() as import('node:net').AddressInfo)?.port ||
              port
            : port
        const targetPort = actualPort === 443 ? '' : `:${actualPort}`
        res.writeHead(301, {
          Location: `https://${targetHost}${targetPort}${req.url || '/'}`,
        })
        res.end()
      })
      this.redirectServer.listen(redirectPort, host, () => {
        this.app.log.info(
          `Redirect server listening on port ${redirectPort} -> HTTPS port ${port}`
        )
      })
    }

    this.server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n\x1b[31m? Port ${port} is already in use.\x1b[0m`)
        console.error(
          `  Try killing the process or use a different port in exis.config.ts\n`
        )
        process.exit(1)
      } else {
        this.app.log.error({ err }, 'Failed to start server')
        process.exit(1)
      }
    })

    this.server.listen(port, host, async () => {
      const address = { port, host }

      // --- onReady Hook ---
      for (const hook of this.app.hooks.ready) {
        await hook()
      }

      if (onListen) {
        onListen(address)
      } else {
        if (!process.env.__EXIS_DEV_SERVER && !process.env.__EXIS_CLI) {
          const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`
          this.app.log.info(
            { url, env: this.app.options.env },
            `Server running at ${url}`
          )
        }
      }
    })

    return this.server
  }

  async close(): Promise<void> {
    if (this.redirectServer) {
      this.redirectServer.close()
    }
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server.close((err: any) => {
          if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') reject(err)
          else resolve()
        })
      })
    }
  }

  closeIdleConnections() {
    if (this.server && 'closeIdleConnections' in this.server) {
      ;(this.server as any).closeIdleConnections()
    }
  }

  closeAllConnections() {
    if (this.server && 'closeAllConnections' in this.server) {
      ;(this.server as any).closeAllConnections()
    }
  }
}
