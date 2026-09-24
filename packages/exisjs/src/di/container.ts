export type ProviderToken<T = any> =
  string | symbol | (new (...args: any[]) => T)

export interface BaseProvider {
  scope?: 'singleton' | 'request' | 'transient'
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
  ValueProvider<T> | FactoryProvider<T> | ClassProvider<T> | T

export const INJECT_METADATA = Symbol.for('exisjs:inject_tokens')
export const OPTIONAL_METADATA = Symbol.for('exisjs:optional_tokens')
export const SCOPE_METADATA = Symbol.for('exisjs:scope')

export class Container {
  private providers = new Map<ProviderToken, any>()
  private singletonCache = new Map<ProviderToken, any>()

  provide<T>(token: ProviderToken<T>, provider: ProviderDefinition<T>): void {
    this.providers.set(token, provider)
    this.singletonCache.delete(token)
  }

  clearCache(): void {
    this.singletonCache.clear()
  }

  instantiateClass<T>(
    TargetClass: new (...args: any[]) => T,
    requestCache?: Map<ProviderToken, any>
  ): T {
    const injectTokens: Record<number, ProviderToken> =
      (TargetClass as any)[INJECT_METADATA] ||
      (TargetClass.prototype &&
        (TargetClass.prototype as any)[INJECT_METADATA]) ||
      {}
    const optionalParams: Set<number> =
      (TargetClass as any)[OPTIONAL_METADATA] ||
      (TargetClass.prototype &&
        (TargetClass.prototype as any)[OPTIONAL_METADATA]) ||
      new Set()

    const maxIndex = Object.keys(injectTokens).reduce(
      (max, curr) => Math.max(max, Number(curr)),
      -1
    )

    if (maxIndex === -1 && optionalParams.size === 0) {
      return new TargetClass()
    }

    const args: any[] = []
    const totalParams = Math.max(
      maxIndex + 1,
      ...Array.from(optionalParams).map((idx) => idx + 1)
    )

    for (let i = 0; i < totalParams; i++) {
      const token = injectTokens[i]
      const isOptional = optionalParams.has(i)

      if (token !== undefined) {
        try {
          args.push(this.resolve(token, requestCache))
        } catch (err) {
          if (isOptional) {
            args.push(undefined)
          } else {
            throw err
          }
        }
      } else if (isOptional) {
        args.push(undefined)
      } else {
        args.push(undefined)
      }
    }

    return new TargetClass(...args)
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
          const scope = token.prototype?.[SCOPE_METADATA] || 'singleton'
          const instance = this.instantiateClass(
            token as new (...args: any[]) => T,
            requestCache
          )

          if (scope === 'transient') {
            return instance
          }

          if (scope === 'request') {
            if (!requestCache) {
              throw new Error(
                `Cannot resolve request-scoped provider '${String(
                  token
                )}' outside of a request context. This usually happens if you try to resolve a request-scoped dependency during app startup, inside a background job, or without passing the request context cache.`
              )
            }
            requestCache.set(token, instance)
          } else {
            this.singletonCache.set(token, instance)
          }
          return instance
        } catch (err: any) {
          const innerMsg = err instanceof Error ? err.message : String(err)
          const error = new Error(
            `Cannot resolve provider for token: ${String(token)}. Inner error: ${innerMsg}`
          )
          ;(error as any).cause = err
          throw error
        }
      }
      throw new Error('Provider not found for token: ' + String(token))
    }

    let resolvedValue: any
    let scope: 'singleton' | 'request' | 'transient' = 'singleton'

    if (typeof provider === 'function') {
      const classScope =
        (provider as any).prototype?.[SCOPE_METADATA] || 'singleton'
      scope = classScope
      resolvedValue = this.instantiateClass(provider as any, requestCache)
    } else if (provider && typeof provider === 'object') {
      if ('scope' in provider && provider.scope) {
        scope = provider.scope
      }

      if ('useValue' in provider) {
        resolvedValue = (provider as ValueProvider<T>).useValue
      } else if ('useFactory' in provider) {
        resolvedValue = (provider as FactoryProvider<T>).useFactory()
      } else if ('useClass' in provider) {
        resolvedValue = this.instantiateClass(
          (provider as ClassProvider<T>).useClass,
          requestCache
        )
      } else {
        resolvedValue = provider
      }
    } else {
      resolvedValue = provider
    }

    if (scope === 'transient') {
      return resolvedValue
    }

    if (scope === 'request') {
      if (!requestCache) {
        throw new Error(
          `Cannot resolve request-scoped provider '${String(
            token
          )}' outside of a request context. This usually happens if you try to resolve a request-scoped dependency during app startup, inside a background job, or without passing the request context cache.`
        )
      }
      requestCache.set(token, resolvedValue)
    } else {
      this.singletonCache.set(token, resolvedValue)
    }

    return resolvedValue
  }

  public async initLifecycle(): Promise<void> {
    for (const [, instance] of this.singletonCache) {
      if (instance && typeof instance === 'object') {
        if (typeof instance.onInit === 'function') {
          await instance.onInit()
        }
        if (typeof instance.onModuleInit === 'function') {
          await instance.onModuleInit()
        }
        if (typeof instance.onApplicationBootstrap === 'function') {
          await instance.onApplicationBootstrap()
        }
      }
    }
  }

  public async destroyLifecycle(signal?: string): Promise<void> {
    for (const [, instance] of this.singletonCache) {
      if (instance && typeof instance === 'object') {
        if (typeof instance.onDestroy === 'function') {
          await instance.onDestroy()
        }
        if (typeof instance.onModuleDestroy === 'function') {
          await instance.onModuleDestroy()
        }
        if (typeof instance.onApplicationShutdown === 'function') {
          await instance.onApplicationShutdown(signal)
        }
      }
    }
  }
}
