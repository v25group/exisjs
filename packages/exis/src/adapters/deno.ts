import type { App } from '../server/app'

/**
 * Creates a Deno handler for an Exis App.
 * Can be used with Deno.serve(serverlessDeno(app))
 */
export function serverlessDeno(app: App) {
  return (request: globalThis.Request) => app.fetch(request)
}
