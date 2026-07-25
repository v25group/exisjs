import type { App } from '../server/app'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface NetlifyContext {}

/**
 * Creates a Netlify Edge Functions handler for an Exis App.
 */
export function serverlessNetlify(app: App) {
  return (request: globalThis.Request, context: NetlifyContext) => {
    return app.fetch(request, context)
  }
}
