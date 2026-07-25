import { executionContext } from '../server/context'
import type { ProviderToken } from './container'

export function inject<T>(token: ProviderToken<T>): T {
  const store = executionContext.getStore()
  if (!store || !store.app) {
    throw new Error(
      'inject() can only be called inside an active Exis context.'
    )
  }
  return store.app.resolve(token, store.diCache)
}
