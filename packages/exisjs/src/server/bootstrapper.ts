import { createServer as createHttpServer } from 'node:http'
import type { Server as HttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { Server as HttpsServer } from 'node:https'
import { createSecureServer as createHttp2Server } from 'node:http2'
import type { Http2SecureServer } from 'node:http2'
import { createBunApp } from './bun-adapter'
import type { ListenOptions } from '../types'
import { RequestHandler } from './request-handler'
import type { App } from './app'

export class ServerBootstrapper {
  private app: App<any>
  private server!: HttpServer | HttpsServer | Http2SecureServer
  private redirectServer: HttpServer | null = null
  private shutdownHooks: (() => Promise<void> | void)[] = []

  public _useBun = false
  public _bunApp: ReturnType<typeof createBunApp> | null = null
  private bunServerInstance: any = null

  public _useUws = false
  public _uwsApp: any = null
  private uwsListenToken: any = null

  constructor(app: App<any>) {
    this.app = app

    const requestedServer = app.explicitOptions.server

    if (requestedServer === 'uws') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('uWebSockets.js')
        this._useUws = true
      } catch {
        app.log.warn(
          "server: 'uws' was requested, but uWebSockets.js is not available. Falling back to the native Node.js HTTP server."
        )
        this.server = this._initServer()
      }
    } else if (
      requestedServer === 'bun' ||
      (requestedServer !== 'node' &&
        typeof Bun !== 'undefined' &&
        app.options.env !== 'test')
    ) {
      if (typeof Bun !== 'undefined') {
        this._useBun = true
      } else {
        if (requestedServer === 'bun') {
          app.log.warn(
            "server: 'bun' was requested, but Bun is not available. Falling back to the native Node.js HTTP server."
          )
        }
        this.server = this._initServer()
      }
    } else {
      this.server = this._initServer()
    }
  }

  public getServer(): HttpServer | HttpsServer | Http2SecureServer {
    return this.server
  }

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

    server.on(
      'upgrade',
      this.app.wsOrchestrator.handleUpgrade.bind(this.app.wsOrchestrator)
    )

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

  public listen(
    portOrOptions?: number | ListenOptions,
    callback?: () => void
  ): HttpServer | HttpsServer | Http2SecureServer {
    if (process.env.EXIS_CLI_MODE === '1') {
      return undefined as unknown as HttpServer
    }

    this.app.applyBuiltins()

    let port: number
    let host: string
    let onListen:
      ((address: { port: number; host: string }) => void) | undefined

    if (typeof portOrOptions === 'number') {
      port = portOrOptions
      host = this.app.options.host as string
      onListen = callback ? () => callback() : undefined
    } else if (typeof portOrOptions === 'object') {
      if (portOrOptions.ssl) {
        this.app.options.ssl = portOrOptions.ssl
        // Re-initialize server if ssl is passed during listen
        this.server = this._initServer()
      }
      if (portOrOptions.redirectHttp !== undefined) {
        this.app.options.redirectHttp = portOrOptions.redirectHttp
      }
      port = portOrOptions.port ?? this.app.options.port
      host = portOrOptions.host ?? this.app.options.host
      onListen = portOrOptions.onListen
    } else {
      port = this.app.options.port!
      host = this.app.options.host!
    }

    // --- uWebSockets.js listen path ---
    if (this._useUws) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createUwsApp } = require('./uws-adapter')
      this._uwsApp = createUwsApp(
        this.app.handle.bind(this.app) as any,
        this.app.wsOrchestrator.handleUwsUpgrade.bind(this.app.wsOrchestrator),
        this.app.options.ssl as any
      )

      this._uwsApp.listen(port, host, async (tokenInfo: any) => {
        if (!tokenInfo) {
          console.error(
            `\n\x1b[31m? Port ${port} is already in use (uWS).\x1b[0m`
          )
          process.exit(1)
        }
        this.uwsListenToken = tokenInfo.token

        const address = { port: tokenInfo.port, host }

        if (this.app.hotReloader) {
          this.app.hotReloader.stop()
        }

        if (onListen) {
          onListen(address)
        } else {
          if (!process.env.__EXIS_DEV_SERVER && !process.env.__EXIS_CLI) {
            const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`
            this.app.log.info(
              { url, env: this.app.options.env, backend: 'uws' },
              `Server running at ${url} (uWS)`
            )
          }
        }

        for (const hook of this.app.hooks.ready) {
          await hook()
        }

        if (callback) callback()
      })

      return this.server
    }

    // --- Bun listen path ---
    if (this._useBun) {
      this._bunApp = createBunApp(
        this.app.handle.bind(this.app) as any,
        this.app.wsOrchestrator.handleBunUpgrade.bind(this.app.wsOrchestrator),
        port,
        host,
        this.app.options.ssl
      )

      this.bunServerInstance = this._bunApp.listen(port, host, async () => {
        const address = { port, host }

        if (this.app.hotReloader) {
          this.app.hotReloader.stop()
        }

        if (onListen) {
          onListen(address)
        } else {
          if (!process.env.__EXIS_DEV_SERVER && !process.env.__EXIS_CLI) {
            const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`
            this.app.log.info(
              { url, env: this.app.options.env, backend: 'bun' },
              `Server running at ${url} (Bun)`
            )
          }
        }

        // --- onReady Hook ---
        for (const hook of this.app.hooks.ready) {
          await hook()
        }

        if (callback) callback()
      })

      // Return a minimal server-like object for compatibility
      return this.server
    }

    // --- Node HTTP listen path ---

    // Auto HTTP -> HTTPS redirect server
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

      // Start queue worker if initialized
      if (this.app._queueWorker) {
        await this.app._queueWorker.start()
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

      if (callback) callback()
    })

    return this.server
  }

  public async printStartupBanner(): Promise<void> {
    const port = this.app.options.port ?? 3000
    const host = this.app.options.host ?? 'localhost'
    const c = {
      cyan: '\x1b[36m',
      green: '\x1b[32m',
      gray: '\x1b[90m',
      dim: '\x1b[2m',
      bold: '\x1b[1m',
      reset: '\x1b[0m',
      magenta: '\x1b[35m',
      bgMagenta: '\x1b[45m',
      white: '\x1b[37m',
      primary: '\x1b[38;2;160;70;255m',
      blue: '\x1b[38;2;41;169;206m',
    }

    let fwVersion = '0.0.0'
    try {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const pkgPath = path.join(__dirname, '../../package.json')
      fwVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version
    } catch {
      /* ignore */
    }

    const displayHost =
      host === '0.0.0.0' || host === '127.0.0.1' ? 'localhost' : host

    let localIp = '<YOUR_IP>'
    try {
      const os = await import('node:os')
      const nets = os.networkInterfaces()
      for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
          if (net.family === 'IPv4' && !net.internal) {
            localIp = net.address
            break
          }
        }
        if (localIp !== '<YOUR_IP>') break
      }
    } catch {
      /* ignore */
    }

    const networkHost =
      host === '0.0.0.0'
        ? `http://${localIp}:${port}`
        : 'use --host 0.0.0.0 to expose'

    const readyMs = Math.round(process.uptime() * 1000)
    const displayEnv =
      this.app.options.env || process.env.NODE_ENV || 'development'
    const workerCount = process.env.__EXIS_CLUSTER_WORKERS

    const cluster = await import('node:cluster')
    // In cluster mode, ONLY let Worker #1 print the banner so we don't spam the console 12 times
    if (cluster.default.isWorker && cluster.default.worker?.id !== 1) {
      return
    }

    if (process.env.__EXIS_IS_RESTART) {
      const time = new Date()
        .toLocaleTimeString('en-US', {
          hour12: true,
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
        })
        .toLowerCase()
      console.log(
        `${c.dim}${time}${c.reset} ${c.primary}[exis]${c.reset} ${c.dim}restarted in ${readyMs} ms${c.reset}`
      )
      return
    }

    console.log(
      `\n  ${c.primary}${c.bold}EXIS v${fwVersion}${c.reset}  ready in ${c.bold}${readyMs} ms${c.reset}\n`
    )
    console.log(
      `  ${c.white}→${c.reset}  ${c.bold}Local:${c.reset}   ${c.blue}http://${displayHost}:${port}/${c.reset}`
    )
    console.log(
      `  ${c.white}→${c.reset}  ${c.dim}Network:${c.reset} ${c.blue}${networkHost}/${c.reset}`
    )
    console.log(
      `  ${c.white}→${c.reset}  ${c.dim}Environ:${c.reset} ${c.green}${displayEnv}${c.reset}`
    )
    if (workerCount && Number(workerCount) > 1) {
      console.log(
        `  ${c.white}→${c.reset}  ${c.dim}Workers:${c.reset} ${c.magenta}${workerCount}${c.reset}`
      )
    }
    console.log(
      `  ${c.white}→${c.reset}  press ${c.bold}h + enter${c.reset} ${c.dim}to show help${c.reset}\n`
    )
  }

  public onShutdown(hook: () => Promise<void> | void): this {
    this.shutdownHooks.push(hook)
    return this
  }

  public close(timeout = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const isCLI = process.env.__EXIS_DEV_SERVER || process.env.__EXIS_CLI
      if (!isCLI) this.app.log.info('Initiating graceful shutdown')

      let finishCalled = false
      const finish = async () => {
        if (finishCalled) return
        finishCalled = true
        try {
          for (const hook of this.shutdownHooks) {
            await hook()
          }
          // Also execute onClose hooks
          for (const hook of this.app.hooks.close) {
            await hook()
          }
          if (this.app.onCloseHook) {
            await this.app.onCloseHook(this.app)
          }
          if (this.app._cronScheduler) {
            this.app._cronScheduler.stop()
          }
          if (this.app._queueWorker) {
            await this.app._queueWorker.stop()
          }
          if (this.app._queueClient) {
            await this.app._queueClient.close()
          }
          if (this.app.hotReloader) {
            await this.app.hotReloader.stop()
          }
          if (!isCLI) this.app.log.info('Graceful shutdown completed')
          resolve()
        } catch (err) {
          this.app.log.error({ err }, 'Error executing shutdown hooks')
          reject(err)
        }
      }

      if (!this._useBun && (!this.server || !this.server.listening)) {
        finish()
        return
      }

      if (this._useBun && !this.bunServerInstance) {
        finish()
        return
      }

      // Close idle keep-alive connections immediately
      if (
        !this._useBun &&
        this.server &&
        'closeIdleConnections' in this.server
      ) {
        ;(
          this.server as { closeIdleConnections?: () => void }
        ).closeIdleConnections?.()
      }

      let checkIdle: NodeJS.Timeout | undefined
      // Set timeout to force close active connections
      const timer = setTimeout(() => {
        this.app.log.warn(
          `Shutdown timeout of ${timeout}ms exceeded, forcefully terminating active connections`
        )
        if (
          !this._useBun &&
          this.server &&
          'closeAllConnections' in this.server
        ) {
          ;(
            this.server as { closeAllConnections?: () => void }
          ).closeAllConnections?.()
        }
        if (checkIdle) clearInterval(checkIdle)
        finish() // Ensure finish is called on timeout
      }, timeout)

      const cleanupAndFinish = async () => {
        checkIdle = setInterval(async () => {
          const active = RequestHandler.activeRequests
          if (active === 0) {
            clearInterval(checkIdle)
            clearTimeout(timer)
            await finish()
          }
        }, 100)
      }

      this.app.wsServer.close()

      for (const client of this.app.rawWsServer.clients) {
        client.terminate()
      }
      this.app.rawWsServer.close()

      if (this.redirectServer) {
        this.redirectServer.close()
      }

      if (this._useBun && this.bunServerInstance) {
        this.bunServerInstance.stop(true)
        this.bunServerInstance = null
        cleanupAndFinish()
      } else if (this._useUws && this._uwsApp && this.uwsListenToken) {
        this._uwsApp.close(this.uwsListenToken)
        this.uwsListenToken = null
        cleanupAndFinish()
      } else {
        this.server.close((err) => {
          if (err) reject(err)
        })
        // Call immediately to start polling active requests concurrently
        cleanupAndFinish()
      }
    })
  }
}
