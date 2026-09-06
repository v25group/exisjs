import { getFormattedTime } from '../utils/time'
import type { ListenOptions } from '../types'
import { RequestHandler } from './request-handler'
import type { App } from './app'
import { NodeEngine } from './engines/node-engine'
import { BunEngine } from './engines/bun-engine'
import { UwsEngine } from './engines/uws-engine'
import type { HttpEngine } from './engines/engine'

export class ServerBootstrapper {
  private app: App<any>
  public engine: HttpEngine
  private shutdownHooks: (() => Promise<void> | void)[] = []

  constructor(app: App<any>) {
    this.app = app

    const requestedServer = app.explicitOptions.server

    if (requestedServer === 'uws') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('uWebSockets.js')
        this.engine = new UwsEngine(app)
      } catch {
        app.log.warn(
          "server: 'uws' was requested, but uWebSockets.js is not available. Falling back to the native Node.js HTTP server."
        )
        this.engine = new NodeEngine(app)
      }
    } else if (
      requestedServer === 'bun' ||
      (requestedServer !== 'node' &&
        typeof Bun !== 'undefined' &&
        app.options.env !== 'test')
    ) {
      if (typeof Bun !== 'undefined') {
        this.engine = new BunEngine(app)
      } else {
        if (requestedServer === 'bun') {
          app.log.warn(
            "server: 'bun' was requested, but Bun is not available. Falling back to the native Node.js HTTP server."
          )
        }
        this.engine = new NodeEngine(app)
      }
    } else {
      this.engine = new NodeEngine(app)
    }
  }

  public getServer(): any {
    // Only used externally if they really need the raw server object.
    return (
      (this.engine as any).server ||
      (this.engine as any).serverInstance ||
      (this.engine as any).uwsApp
    )
  }

  public listen(
    portOrOptions?: number | ListenOptions,
    callback?: () => void
  ): any {
    if (process.env.EXIS_CLI_MODE === '1') {
      return undefined as any
    }

    this.app.applyBuiltins()

    let port: number
    let host: string
    let onListen:
      ((address: { port: number; host: string }) => void) | undefined
    let options: ListenOptions = {}

    if (typeof portOrOptions === 'number') {
      port = portOrOptions
      host = this.app.options.host as string
      onListen = callback ? () => callback() : undefined
    } else if (typeof portOrOptions === 'object') {
      options = portOrOptions
      port = portOrOptions.port ?? this.app.options.port
      host = portOrOptions.host ?? this.app.options.host
      onListen = portOrOptions.onListen
    } else {
      port = this.app.options.port!
      host = this.app.options.host!
    }

    if (callback && !onListen) {
      onListen = callback
    }

    return this.engine.listen(port, host, options, onListen as any)
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
      const time = getFormattedTime()
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

          if (!isCLI) this.app.log.info('Graceful shutdown completed')
          resolve()
        } catch (err) {
          this.app.log.error({ err }, 'Error executing shutdown hooks')
          reject(err)
        }
      }

      if (!this.engine) {
        finish()
        return
      }

      setTimeout(async () => {
        await this.engine.close()
        process.exit(0)
      }, timeout).unref()

      // Close idle keep-alive connections immediately
      if ('closeIdleConnections' in this.engine) {
        ;(this.engine as any).closeIdleConnections?.()
      }

      let checkIdle: NodeJS.Timeout | undefined
      // Set timeout to force close active connections
      const timer = setTimeout(() => {
        this.app.log.warn(
          `Shutdown timeout of ${timeout}ms exceeded, forcefully terminating active connections`
        )
        if ('closeAllConnections' in this.engine) {
          ;(this.engine as any).closeAllConnections?.()
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

      this.engine.close()
      cleanupAndFinish()
    })
  }
}
