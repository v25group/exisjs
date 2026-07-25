import type { ExisPlugin, ExisPluginInstance } from '../types'

/**
 * Defines a new Exis plugin.
 * Returns a hybrid object that can be passed directly to `app.register()` OR called as a function `myPlugin({ options })`.
 */
export function definePlugin<TOptions = Record<string, unknown>>(
  plugin: ExisPlugin<TOptions>
): ExisPlugin<TOptions> & ((options?: TOptions) => ExisPluginInstance) {
  const factory = (options?: TOptions) => ({
    plugin: plugin as ExisPlugin<unknown>,
    options,
  })

  // Safely copy properties from the plugin object to the factory function
  // Functions have a read-only 'name' property, so we must use Object.defineProperty
  for (const key of Object.keys(plugin)) {
    if (key === 'name') {
      Object.defineProperty(factory, 'name', {
        value: plugin.name,
        writable: false,
        configurable: true,
      })
    } else {
      ;(factory as any)[key] = (plugin as any)[key]
    }
  }

  return factory as ExisPlugin<TOptions> &
    ((options?: TOptions) => ExisPluginInstance)
}
