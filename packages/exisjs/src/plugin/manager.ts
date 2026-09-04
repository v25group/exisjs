import type { App } from '../server/app'
import { Router } from '../router/router'
import type {
  ExisPlugin,
  ExisPluginInstance,
  Handler,
  ErrorHandler,
  HookReady,
  HookClose,
  HookRequest,
  HookResponse,
  HookError,
  HookRoute,
} from '../types'

export class PluginManager {
  private registeredPlugins = new Map<string, ExisPlugin<unknown>>()

  public hooks = {
    ready: [] as HookReady[],
    close: [] as HookClose[],
    request: [] as HookRequest[],
    response: [] as HookResponse[],
    error: [] as HookError[],
    route: [] as HookRoute[],
  }

  public onStartHook?: (app: App) => void | Promise<void>
  public onCloseHook?: (app: App) => void | Promise<void>

  constructor(private app: App) {}

  // ─── Lifecycle Hooks Registration ───────────────────────────────────────────
  onReady(cb: HookReady): App {
    this.hooks.ready.push(cb)
    return this.app
  }

  onClose(cb: HookClose): App {
    this.hooks.close.push(cb)
    return this.app
  }

  onRequest(cb: HookRequest): App {
    this.hooks.request.push(cb)
    return this.app
  }

  onResponse(cb: HookResponse): App {
    this.hooks.response.push(cb)
    return this.app
  }

  onError(cb: HookError): App {
    this.hooks.error.push(cb)
    return this.app
  }

  onRoute(cb: HookRoute): App {
    this.hooks.route.push(cb)
    return this.app
  }

  // ─── Plugin System ──────────────────────────────────────────────────────────

  public hasPlugin(name: string): boolean {
    return this.registeredPlugins.has(name)
  }

  public async register<TOptions = Record<string, unknown>>(
    pluginOrInstance: ExisPlugin<TOptions> | ExisPluginInstance,
    legacyOptions?: TOptions
  ): Promise<App> {
    let plugin: ExisPlugin<TOptions>
    let options: TOptions | undefined

    if ('plugin' in pluginOrInstance && !('register' in pluginOrInstance)) {
      plugin = pluginOrInstance.plugin as ExisPlugin<TOptions>
      options = pluginOrInstance.options as TOptions
    } else {
      plugin = pluginOrInstance as ExisPlugin<TOptions>
      options = legacyOptions
    }

    if (this.registeredPlugins.has(plugin.name)) {
      throw new Error(`Plugin '${plugin.name}' is already registered`)
    }

    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.registeredPlugins.has(dep)) {
          throw new Error(
            `Plugin '${plugin.name}' requires dependency '${dep}' which is not registered`
          )
        }
      }
    }

    let targetApp: App = this.app
    let pluginRouter: Router | undefined

    if (plugin.encapsulate !== false) {
      pluginRouter = new Router()
      // Create a proxy that intercepts route and middleware registrations
      targetApp = new Proxy(this.app, {
        get(target, prop, receiver) {
          if (
            [
              'get',
              'post',
              'put',
              'patch',
              'delete',
              'httpOptions',
              'head',
              'all',
              'ws',
              'query',
              'connect',
              'trace',
            ].includes(prop as string)
          ) {
            return (path: string, ...handlers: Handler[]) => {
              const routerMethod =
                prop === 'httpOptions' ? 'options' : (prop as string)
              ;(
                pluginRouter as unknown as Record<
                  string,
                  (...args: unknown[]) => unknown
                >
              )[routerMethod](path, ...handlers)
              return receiver
            }
          }
          if (prop === 'use') {
            return (...handlers: (Handler | ErrorHandler)[]) => {
              for (const h of handlers) {
                if (h.length === 4) {
                  // error handlers stay global for now, or we could scope them
                  target.use(h)
                } else {
                  pluginRouter!.use(h as Handler)
                }
              }
              return receiver
            }
          }

          // Encapsulate lifecycle hooks by converting them to scoped middleware!
          if (['onRequest', 'onResponse'].includes(prop as string)) {
            return (cb: any) => {
              if (prop === 'onRequest') {
                pluginRouter!.use(async (req: any, res: any, next: any) => {
                  try {
                    await cb(req, res)
                    next()
                  } catch (err) {
                    next(err)
                  }
                })
              } else if (prop === 'onResponse') {
                pluginRouter!.use((req: any, res: any, next: any) => {
                  res.raw.on('finish', () => {
                    cb(req, res).catch(() => {
                      /* ignore */
                    })
                  })
                  next()
                })
              }
              return receiver
            }
          }

          const value = Reflect.get(target, prop, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }

    await plugin.register(targetApp, options)

    if (pluginRouter) {
      this.app.mount('/', pluginRouter)
    }

    this.registeredPlugins.set(plugin.name, plugin as ExisPlugin<unknown>)
    return this.app
  }
}
