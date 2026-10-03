import { executionContext } from '../server/context'
import type { ProviderToken } from './container'

/**
 * Injects a dependency from the Exis Application container.
 * When called inside an active route or middleware context, it resolves with request-scoped caching.
 * When called outside of a request context, it resolves from the active application container.
 *
 * Example:
 *
 *     route.get('/users', {
 *       handle() {
 *         const db = inject('Database');
 *         return db.query('SELECT * FROM users');
 *       }
 *     });
 *
 * @param {ProviderToken<T>} token The injection token (string, symbol, or class)
 * @return {T} The resolved dependency
 * @public
 */
export function inject<T>(token: ProviderToken<T>): T {
  const store = executionContext.getStore()
  if (!store || !store.app) {
    throw new Error(
      'inject() can only be called inside an active Exis context.'
    )
  }
  return store.app.resolve(token, store.diCache)
}
