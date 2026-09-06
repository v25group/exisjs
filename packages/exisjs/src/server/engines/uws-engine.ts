import type { HttpEngine } from './engine'
import type { App } from '../app'
import type { ListenOptions } from '../../types'

export class UwsEngine implements HttpEngine {
  public readonly name = 'uws'
  private uwsApp: any = null
  private listenToken: any = null

  constructor(private app: App<any>) {}

  listen(
    port: number,
    host: string,
    options: ListenOptions,
    onListen: (address: { port: number; host: string }) => void
  ): any {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createUwsApp } = require('../adapters/uws-adapter')

    this.uwsApp = createUwsApp(
      this.app.handle.bind(this.app) as any,
      options.ssl ?? this.app.options.ssl
    )

    this.uwsApp.listen(port, host, async (tokenInfo: any) => {
      if (!tokenInfo) {
        console.error(
          `\n\x1b[31m? Port ${port} is already in use (uWS).\x1b[0m`
        )
        process.exit(1)
      }
      this.listenToken = tokenInfo.token

      const address = { port: tokenInfo.port, host }

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
            { url, env: this.app.options.env, backend: 'uws' },
            `Server running at ${url} (uWS)`
          )
        }
      }
    })

    return this.uwsApp
  }

  async close(): Promise<void> {
    if (this.uwsApp && this.listenToken) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const uws = require('uWebSockets.js')
      uws.us_listen_socket_close(this.listenToken)
      this.listenToken = null
    }
  }
}
