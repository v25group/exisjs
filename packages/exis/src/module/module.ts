import type { App } from '../server/app'
import type { ExisPlugin } from '../types'
import type { ProviderDefinition } from '../di/container'

export interface ModuleOptions {
  name: string
  imports?: ExisPlugin[]
  providers?: [string, ProviderDefinition<any>][]
  routes?: (app: App) => void
  onStart?: (app: App) => void | Promise<void>
  onClose?: (app: App) => void | Promise<void>
}

/**
 * Defines a functional standalone Module.
 * Modules elegantly group dependencies (providers), imports, and routes into a single encapsulated plugin.
 */
export function defineModule(options: ModuleOptions): ExisPlugin {
  return {
    name: options.name,
    register: async (app: App) => {
      // 1. Process imports (Sub-modules)
      if (options.imports) {
        for (const mod of options.imports) {
          if (!app.hasPlugin(mod.name)) {
            await app.register(mod)
          }
        }
      }

      // 2. Register Providers into the DI container
      if (options.providers) {
        for (const [token, config] of options.providers) {
          app.provide(token, config)
        }
      }

      // 3. Register optional manual routes
      if (options.routes) {
        options.routes(app)
      }

      // 4. Hook into lifecycle if needed
      if (options.onStart) {
        await options.onStart(app)
      }
    },
  }
}
