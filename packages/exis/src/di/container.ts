export type ProviderToken<T = any> =
  | string
  | symbol
  | (new (...args: any[]) => T)

export interface BaseProvider {
  scope?: 'singleton' | 'request'
}

export interface ValueProvider<T> extends BaseProvider {
  useValue: T
}

export interface FactoryProvider<T> extends BaseProvider {
  useFactory: () => T | Promise<T>
}

export interface ClassProvider<T> extends BaseProvider {
  useClass: new (...args: any[]) => T
}

export type ProviderDefinition<T> =
  | ValueProvider<T>
  | FactoryProvider<T>
  | ClassProvider<T>
  | T

export class Container {
  private providers = new Map<ProviderToken, any>()
  private singletonCache = new Map<ProviderToken, any>()

  provide<T>(token: ProviderToken<T>, provider: ProviderDefinition<T>): void {
    this.providers.set(token, provider)
    this.singletonCache.delete(token)
  }

  resolve<T>(
    token: ProviderToken<T>,
    requestCache?: Map<ProviderToken, any>
  ): T {
    // 1. Check singleton cache
    if (this.singletonCache.has(token)) {
      return this.singletonCache.get(token)
    }

    // 2. Check request cache
    if (requestCache && requestCache.has(token)) {
      return requestCache.get(token)
    }

    const provider = this.providers.get(token)
    if (provider === undefined) {
      if (typeof token === 'function') {
        try {
          const SCOPE_METADATA = Symbol.for('exisjs:scope')
          const scope = token.prototype[SCOPE_METADATA] || 'singleton'

          const instance = new (token as new (...args: any[]) => T)()
          if (scope === 'request') {
            if (!requestCache) {
              throw new Error(
                `Cannot resolve request-scoped provider '${String(
                  token
                )}' outside of a request context.`
              )
            }
            requestCache.set(token, instance)
          } else {
            this.singletonCache.set(token, instance)
          }
          return instance
        } catch {
          throw new Error(`Cannot resolve provider for token: ${String(token)}`)
        }
      }
      throw new Error('Provider not found for token: ' + String(token))
    }

    let resolvedValue: any
    let scope: 'singleton' | 'request' = 'singleton'

    if (provider && typeof provider === 'object') {
      if ('scope' in provider && provider.scope === 'request') {
        scope = 'request'
      }

      if ('useValue' in provider) {
        resolvedValue = (provider as ValueProvider<T>).useValue
      } else if ('useFactory' in provider) {
        resolvedValue = (provider as FactoryProvider<T>).useFactory()
      } else if ('useClass' in provider) {
        resolvedValue = new (provider as ClassProvider<T>).useClass()
      } else {
        resolvedValue = provider // For T that happens to be an object without these keys
      }
    } else {
      resolvedValue = provider
    }

    if (scope === 'request') {
      if (!requestCache) {
        throw new Error(
          `Cannot resolve request-scoped provider '${String(
            token
          )}' outside of a request context.`
        )
      }
      requestCache.set(token, resolvedValue)
    } else {
      this.singletonCache.set(token, resolvedValue)
    }

    return resolvedValue
  }
}
