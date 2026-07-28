import type { App } from '../server/app'

/**
 * Creates a Fastly Compute@Edge handler for an Exis App.
 */
export function fastly(app: App) {
  let initialized = false

  return async (event: any) => {
    if (!initialized) {
      if (typeof app.create === 'function') await app.create()
      if (typeof app.onStartHook === 'function') await app.onStartHook(app)
      initialized = true
    }
    event.respondWith(app.fetch(event.request, event))
  }
}
