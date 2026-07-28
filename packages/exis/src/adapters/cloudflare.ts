import type { App } from '../server/app'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CloudflareEnv {}

/**
 * Creates a Cloudflare Workers handler for an Exis App.
 */
export function cloudflare(app: App) {
  let initialized = false

  return {
    fetch: async (
      request: globalThis.Request,
      env: CloudflareEnv,
      ctx: any
    ) => {
      if (!initialized) {
        if (typeof app.create === 'function') await app.create()
        if (typeof app.onStartHook === 'function') await app.onStartHook(app)
        initialized = true
      }
      return app.fetch(request, env, ctx)
    },
  }
}
