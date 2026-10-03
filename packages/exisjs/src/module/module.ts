import type { App } from '../server/app'
import type { ExisPlugin } from '../types'
import type {
  ProviderToken,
  ProviderDefinition,
  CustomProvider,
} from '../di/container'

export type ModuleProviderItem =
  | [ProviderToken<any>, ProviderDefinition<any>]
  | CustomProvider<any>
  | (new (...args: any[]) => any)
  | any

export interface ModuleOptions {
  name: string
  imports?: ExisPlugin[]
  providers?: ModuleProviderItem[]
  routes?: (app: App) => void
  onStart?: (app: App) => void | Promise<void>
  onClose?: (app: App) => void | Promise<void>
}

/**
 * Defines a functional standalone Module.
 * Modules elegantly group dependencies (providers), imports, and routes into a single encapsulated plugin.
 *
 * Example:
 *
 *     export const userModule = defineModule({
 *       name: 'UserModule',
 *       providers: [
 *         UserService,
 *         { provide: 'CONFIG', useValue: { port: 3000 } },
 *         ['CustomToken', { useClass: CustomService }]
 *       ],
 *       routes(app) {
 *         app.router.use('/users', userController);
 *       }
 *     });
 *
 * @param {ModuleOptions} options Module configuration options
 * @return {ExisPlugin} The built Exis module
 * @public
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
        for (const item of options.providers) {
          if (Array.isArray(item)) {
            const [token, config] = item
            app.provide(token, config)
          } else if (typeof item === 'function') {
            app.provide(item, { useClass: item })
          } else if (item && typeof item === 'object' && 'provide' in item) {
            app.provide(item)
          } else {
            app.provide(item as any, item as any)
          }
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
