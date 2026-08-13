import type { App } from './app'
import type { ExisConfig } from '../types'

export interface ExisAppOptions extends ExisConfig {
  onStart?: (app: App) => void | Promise<void>
  onClose?: (app: App) => void | Promise<void>
}

export class ExisAppDefinition {
  public _isExisAppDefinition = true
  constructor(public options: ExisAppOptions = {}) {}

  /**
   * Programmatically boot the application (e.g., for testing or benchmarks).
   * Note: This is handled automatically by the CLI.
   */
  public async boot(): Promise<App> {
    const { App, setActiveAppInstance } = await import('./app')
    const app = new App(this.options)

    if (this.options.onStart) {
      app.onStartHook = this.options.onStart
    }
    if (this.options.onClose) {
      app.onCloseHook = this.options.onClose
    }

    setActiveAppInstance(app)
    await app.create()

    if (typeof app.onStartHook === 'function') {
      await app.onStartHook(app)
    }

    return app
  }
}

/**
 * Declaratively define an Exis application.
 * The CLI will handle initialization and listening automatically.
 *
 * Example:
 *
 *     import { exis } from 'exisjs';
 *     import { rootRouter } from './router';
 *
 *     export default exis({
 *       port: 3000,
 *       routers: [rootRouter]
 *     });
 *
 * @param {ExisAppOptions} [options] Application configuration and hooks
 * @returns {ExisAppDefinition} The application definition object
 * @public
 */
export function defineApp(options?: ExisAppOptions): ExisAppDefinition {
  return new ExisAppDefinition(options)
}

export { defineGateway } from '../router/gateway'
export type { GatewayConfig } from '../router/gateway'
