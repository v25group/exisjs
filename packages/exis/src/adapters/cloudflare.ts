import type { App } from '../server/app'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CloudflareEnv {}

/**
 * Creates a Cloudflare Workers handler for an Exis App.
 */
export function serverlessCloudflare(app: App) {
  return {
    fetch: (request: globalThis.Request, env: CloudflareEnv, ctx: any) => {
      return app.fetch(request, env, ctx)
    },
  }
}
