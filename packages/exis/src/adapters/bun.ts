import type { App } from '../server/app'

/**
 * Creates a Bun handler for an Exis App.
 * Can be used with Bun.serve(serverlessBun(app))
 */
export function serverlessBun(app: App) {
  return {
    fetch(request: globalThis.Request, server: any) {
      return app.fetch(request, server)
    },
  }
}
