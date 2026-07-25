import type { App } from '../server/app'

/**
 * Creates a Fastly Compute@Edge handler for an Exis App.
 */
export function serverlessFastly(app: App) {
  return (event: any) => {
    event.respondWith(app.fetch(event.request, event))
  }
}
