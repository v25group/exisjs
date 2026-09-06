import type { HttpEngine } from './engine'
import type { App } from '../app'
import type { ListenOptions } from '../../types'

export class BunEngine implements HttpEngine {
  public readonly name = 'bun'
  private bunApp: any = null
  private serverInstance: any = null

  constructor(private app: App<any>) {}

  listen(
    port: number,
    host: string,
    options: ListenOptions,
    onListen: (address: { port: number; host: string }) => void
  ): any {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createBunApp } = require('../adapters/bun-adapter')

    this.bunApp = createBunApp(
      this.app.handle.bind(this.app) as any,
      port,
      host,
      options.ssl ?? this.app.options.ssl
    )

    this.serverInstance = this.bunApp.listen(port, host, async () => {
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
            { url, env: this.app.options.env, backend: 'bun' },
            `Server running at ${url} (Bun)`
          )
        }
      }
    })

    return this.serverInstance
  }

  async close(): Promise<void> {
    if (this.serverInstance) {
      this.serverInstance.stop()
      this.serverInstance = null
    }
  }
}
