import type { App } from '../server/app'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface NetlifyContext {}

/**
 * Creates a Netlify Edge Functions handler for an Exis App.
 */
export function netlify(app: App) {
  let initialized = false

  return async (request: globalThis.Request, context: NetlifyContext) => {
    if (!initialized) {
      if (typeof app.create === 'function') await app.create()
      if (typeof app.onStartHook === 'function') await app.onStartHook(app)
      initialized = true
    }
    return app.fetch(request, context)
  }
}
