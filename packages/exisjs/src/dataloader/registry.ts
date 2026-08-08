import { getContext, setContext } from '../server/context'
import type { Dataloader } from './dataloader'

/**
 * Defines a registry of per-request Dataloaders securely bound to the Exis context.
 */
export function defineLoaders<
  T extends Record<string, () => Dataloader<any, any>>,
>(factories: T) {
  return {
    /**
     * Middleware that lazy-initializes all loaders into the current request context.
     * Register this globally or on a gateway.
     */
    loaderMiddleware: (req: any, res: any, next: any) => {
      const instances = {} as any

      // We lazily instantiate the loaders so we don't pay the penalty
      // if a specific loader isn't used in this request.
      for (const key of Object.keys(factories)) {
        Object.defineProperty(instances, key, {
          get: () => {
            if (!instances[`_${key}`]) {
              instances[`_${key}`] = factories[key]()
            }
            return instances[`_${key}`]
          },
          enumerable: true,
        })
      }

      setContext('loaders', instances)

      if (next) next()
    },

    /**
     * Strongly-typed hook to retrieve the isolated loaders anywhere in the codebase
     * without needing to pass the req object.
     */
    getLoaders: () => {
      const state = getContext<{
        loaders: { [K in keyof T]: ReturnType<T[K]> }
      }>()
      if (!state || !state.loaders) {
        throw new Error(
          'getLoaders() was called, but the loaderMiddleware is not registered. ' +
            'Please ensure loaderMiddleware is added to your app or gateway.'
        )
      }
      return state.loaders
    },
  }
}
