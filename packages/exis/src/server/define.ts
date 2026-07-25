import { App } from './app'
import type { ExisConfig } from '../types'

export interface ExisAppOptions extends ExisConfig {
  onStart?: (app: App) => void | Promise<void>
  onClose?: (app: App) => void | Promise<void>
}

/**
 * Declaratively define an Exis application.
 * The CLI will handle initialization and listening automatically.
 */
export function defineApp(options?: ExisAppOptions): App {
  const app = new App(options)

  if (options?.onStart) {
    app.onStartHook = options.onStart
  }

  if (options?.onClose) {
    app.onCloseHook = options.onClose
  }

  return app
}

export { defineGateway } from '../router/gateway'
export type { GatewayConfig } from '../router/gateway'
