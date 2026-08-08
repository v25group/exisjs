import type { App } from '../server/app'

/**
 * Creates a Deno handler for an Exis App.
 * Can be used with Deno.serve(serverlessDeno(app))
 */
export function deno(app: App) {
  let initialized = false

  return async (request: globalThis.Request) => {
    if (!initialized) {
      if (typeof app.create === 'function') await app.create()
      if (typeof app.onStartHook === 'function') await app.onStartHook(app)
      initialized = true
    }
    return app.fetch(request)
  }
}
