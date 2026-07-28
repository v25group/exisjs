import type { App } from '../server/app'

/**
 * Creates a Bun handler for an Exis App.
 * Can be used with Bun.serve(serverlessBun(app))
 */
export function bun(app: App) {
  let initialized = false

  return {
    async fetch(request: globalThis.Request, server: any) {
      if (!initialized) {
        if (typeof app.create === 'function') await app.create()
        if (typeof app.onStartHook === 'function') await app.onStartHook(app)
        initialized = true
      }
      return app.fetch(request, server)
    },
  }
}
