import { isForwardRef, type ForwardReference } from './forward-ref'

export type ProviderToken<T = any> =
  string | symbol | (new (...args: any[]) => T) | ForwardReference<T>

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
export const PROPERTY_INJECT_METADATA = Symbol.for(
  'exisjs:property_inject_tokens'
)
export const OPTIONAL_METADATA = Symbol.for('exisjs:optional_tokens')
export const SCOPE_METADATA = Symbol.for('exisjs:scope')

export class Container {
  private providers = new Map<any, any>()
  private singletonCache = new Map<any, any>()
  private inFlight = new Set<any>()

  provide<T>(token: ProviderToken<T>, provider: ProviderDefinition<T>): void {
    const unwrappedToken = isForwardRef(token) ? token.forwardRef() : token
    this.providers.set(unwrappedToken, provider)
    this.singletonCache.delete(unwrappedToken)
  }

  clearCache(): void {
    this.singletonCache.clear()
    this.inFlight.clear()
  }

  instantiateClass<T>(
    TargetClass: new (...args: any[]) => T,
    requestCache?: Map<any, any>
  ): T {
    const injectTokens: Record<number, ProviderToken> = {
      ...((TargetClass.prototype &&
        (TargetClass.prototype as any)[INJECT_METADATA]) ||
        {}),
      ...((TargetClass as any)[INJECT_METADATA] || {}),
    }
    const optionalParams: Set<number> =
      (TargetClass as any)[OPTIONAL_METADATA] ||
      (TargetClass.prototype &&
        (TargetClass.prototype as any)[OPTIONAL_METADATA]) ||
      new Set()

    // 1. Inspect reflected parameter types emitted by TypeScript (design:paramtypes)
    const reflectParamTypes: any[] =
      (typeof (globalThis as any).Reflect?.getMetadata === 'function'
        ? (globalThis as any).Reflect.getMetadata(
            'design:paramtypes',
            TargetClass
          ) ||
          (TargetClass.prototype
            ? (globalThis as any).Reflect.getMetadata(
                'design:paramtypes',
                TargetClass.prototype
              )
            : undefined)
        : undefined) ||
      (TargetClass as any)['design:paramtypes'] ||
      (TargetClass.prototype as any)?.['design:paramtypes'] ||
      []

    // Merge reflected constructor parameters if not explicitly overridden by @Inject()
    if (Array.isArray(reflectParamTypes) && reflectParamTypes.length > 0) {
      for (let i = 0; i < reflectParamTypes.length; i++) {
        const paramType = reflectParamTypes[i]
        if (
          injectTokens[i] === undefined &&
          typeof paramType === 'function' &&
          paramType !== Object &&
          paramType !== String &&
          paramType !== Number &&
          paramType !== Boolean &&
          paramType !== Symbol &&
          paramType !== Array &&
          paramType !== Function
        ) {
          injectTokens[i] = paramType
        }
      }
    }

    const tokenIndices = Object.keys(injectTokens).map(Number)
    const maxIndex = tokenIndices.length > 0 ? Math.max(...tokenIndices) : -1

    let instance: T

    if (
      maxIndex === -1 &&
      optionalParams.size === 0 &&
      (!TargetClass.length || TargetClass.length === 0)
    ) {
      instance = new TargetClass()
    } else {
      const totalParams = Math.max(
        maxIndex + 1,
        TargetClass.length || 0,
        ...Array.from(optionalParams).map((idx) => idx + 1)
      )

      if (totalParams === 0) {
        instance = new TargetClass()
      } else {
        const args: any[] = []
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
        instance = new TargetClass(...args)
      }
    }

    // 2. Perform property-level dependency injections across prototype hierarchy
    if (TargetClass.prototype) {
      const protoChain: any[] = []
      let curr = TargetClass.prototype
      while (curr && curr !== Object.prototype) {
        protoChain.unshift(curr)
        curr = Object.getPrototypeOf(curr)
      }

      for (const p of protoChain) {
        const propInjections: {
          propertyKey: string | symbol
          token?: ProviderToken
        }[] = p[PROPERTY_INJECT_METADATA] || []
        const optProps: Set<string | symbol> = p[OPTIONAL_METADATA] || new Set()

        for (const { propertyKey, token } of propInjections) {
          let resolvedToken = token
          if (resolvedToken === undefined) {
            const reflectedType =
              typeof (globalThis as any).Reflect?.getMetadata === 'function'
                ? (globalThis as any).Reflect.getMetadata(
                    'design:type',
                    p,
                    propertyKey
                  )
                : undefined
            if (reflectedType) resolvedToken = reflectedType
          }

          if (resolvedToken !== undefined) {
            try {
              ;(instance as any)[propertyKey] = this.resolve(
                resolvedToken,
                requestCache
              )
            } catch (err) {
              if (optProps.has(propertyKey)) {
                ;(instance as any)[propertyKey] = undefined
              } else {
                throw err
              }
            }
          }
        }
      }
    }

    return instance
  }

  resolve<T>(token: ProviderToken<T>, requestCache?: Map<any, any>): T {
    const unwrappedToken: any = isForwardRef(token) ? token.forwardRef() : token

    // 1. Check singleton cache
    if (this.singletonCache.has(unwrappedToken)) {
      return this.singletonCache.get(unwrappedToken)
    }

    // 2. Check request cache
    if (requestCache && requestCache.has(unwrappedToken)) {
      return requestCache.get(unwrappedToken)
    }

    // 3. Circular Dependency Resolution: Return Lazy Proxy
    if (this.inFlight.has(unwrappedToken)) {
      return new Proxy({} as any, {
        get: (_, prop) => {
          const realInstance =
            this.singletonCache.get(unwrappedToken) ||
            (requestCache && requestCache.get(unwrappedToken))
          if (realInstance) {
            const val = realInstance[prop]
            return typeof val === 'function' ? val.bind(realInstance) : val
          }
          return undefined
        },
        set: (_, prop, value) => {
          const realInstance =
            this.singletonCache.get(unwrappedToken) ||
            (requestCache && requestCache.get(unwrappedToken))
          if (realInstance) {
            realInstance[prop] = value
            return true
          }
          return false
        },
      })
    }

    const provider = this.providers.get(unwrappedToken)
    if (provider === undefined) {
      if (typeof unwrappedToken === 'function') {
        this.inFlight.add(unwrappedToken)
        try {
          const scope =
            unwrappedToken.prototype?.[SCOPE_METADATA] || 'singleton'
          const instance = this.instantiateClass(
            unwrappedToken as new (...args: any[]) => T,
            requestCache
          )

          if (scope === 'transient') {
            return instance
          }

          if (scope === 'request') {
            if (!requestCache) {
              throw new Error(
                `Cannot resolve request-scoped provider '${String(
                  unwrappedToken
                )}' outside of a request context. This usually happens if you try to resolve a request-scoped dependency during app startup, inside a background job, or without passing the request context cache.`
              )
            }
            requestCache.set(unwrappedToken, instance)
          } else {
            this.singletonCache.set(unwrappedToken, instance)
          }
          return instance
        } catch (err: any) {
          const innerMsg = err instanceof Error ? err.message : String(err)
          const error = new Error(
            `Cannot resolve provider for token: ${String(
              unwrappedToken
            )}. Inner error: ${innerMsg}`
          )
          ;(error as any).cause = err
          throw error
        } finally {
          this.inFlight.delete(unwrappedToken)
        }
      }
      throw new Error('Provider not found for token: ' + String(unwrappedToken))
    }

    let resolvedValue: any
    let scope: 'singleton' | 'request' | 'transient' = 'singleton'

    this.inFlight.add(unwrappedToken)
    try {
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
              unwrappedToken
            )}' outside of a request context. This usually happens if you try to resolve a request-scoped dependency during app startup, inside a background job, or without passing the request context cache.`
          )
        }
        requestCache.set(unwrappedToken, resolvedValue)
      } else {
        this.singletonCache.set(unwrappedToken, resolvedValue)
      }

      return resolvedValue
    } finally {
      this.inFlight.delete(unwrappedToken)
    }
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
