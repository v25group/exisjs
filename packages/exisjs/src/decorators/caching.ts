export interface CacheableOptions {
  /** Time to live in seconds (default: 300 seconds) */
  ttl?: number
  /** Custom key string or key generator function based on method arguments */
  key?: string | ((...args: any[]) => string)
}

export interface CacheEvictOptions {
  /** Key string or key generator function to evict */
  key: string | ((...args: any[]) => string)
}

class MethodCacheStore {
  private nativeCache: any
  private fallbackCache = new Map<string, { val: any; exp: number }>()
  private isFallback = false

  constructor() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { NativeMemoryCache } = require('@exisjs/rs')
      this.nativeCache = new NativeMemoryCache(50000)
    } catch {
      this.isFallback = true
    }
  }

  public get(key: string): any {
    if (!this.isFallback && this.nativeCache) {
      try {
        const raw = this.nativeCache.get(key)
        if (raw !== undefined && raw !== null) {
          return JSON.parse(raw)
        }
      } catch {
        // Fall back to memory map
      }
    }

    const item = this.fallbackCache.get(key)
    if (!item) return undefined
    if (Date.now() > item.exp) {
      this.fallbackCache.delete(key)
      return undefined
    }
    return item.val
  }

  public set(key: string, value: any, ttlSeconds = 300): void {
    if (!this.isFallback && this.nativeCache) {
      try {
        this.nativeCache.set(key, JSON.stringify(value), ttlSeconds * 1000)
        return
      } catch {
        // Fall back
      }
    }

    this.fallbackCache.set(key, {
      val: value,
      exp: Date.now() + ttlSeconds * 1000,
    })
  }

  public delete(key: string): void {
    if (!this.isFallback && this.nativeCache) {
      try {
        this.nativeCache.delete(key)
      } catch {
        // noop
      }
    }
    this.fallbackCache.delete(key)
  }

  public clear(): void {
    if (!this.isFallback && this.nativeCache) {
      try {
        this.nativeCache.clear()
      } catch {
        // noop
      }
    }
    this.fallbackCache.clear()
  }
}

export const methodCache = new MethodCacheStore()

/**
 * Caches the return value of a service method off-heap in the Rust native engine / memory cache.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class RoleService {
 *   @Cacheable({ ttl: 300, key: (id) => `role:${id}` })
 *   async findById(id: string) {
 *     return this.db.query('SELECT * FROM roles WHERE id = $1', [id])
 *   }
 * }
 * ```
 */
export function Cacheable(options: CacheableOptions = {}): MethodDecorator {
  return function (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value
    const ttl = options.ttl ?? 300

    descriptor.value = async function (...args: any[]) {
      let cacheKey: string
      if (typeof options.key === 'function') {
        cacheKey = options.key(...args)
      } else if (typeof options.key === 'string') {
        cacheKey = `${options.key}:${JSON.stringify(args)}`
      } else {
        const className = target?.constructor?.name || 'Class'
        cacheKey = `${className}.${String(propertyKey)}:${JSON.stringify(args)}`
      }

      const cachedValue = methodCache.get(cacheKey)
      if (cachedValue !== undefined) {
        return cachedValue
      }

      const result = await originalMethod.apply(this, args)
      if (result !== undefined) {
        methodCache.set(cacheKey, result, ttl)
      }
      return result
    }

    return descriptor
  }
}

/**
 * Automatically evicts cached keys from the cache after method execution.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class RoleService {
 *   @CacheEvict({ key: (id) => `role:${id}` })
 *   async updateRole(id: string, data: any) {
 *     return this.db.update('roles', id, data)
 *   }
 * }
 * ```
 */
export function CacheEvict(options: CacheEvictOptions): MethodDecorator {
  return function (
    _target: any,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      const result = await originalMethod.apply(this, args)

      let cacheKey: string
      if (typeof options.key === 'function') {
        cacheKey = options.key(...args)
      } else {
        cacheKey = options.key
      }

      methodCache.delete(cacheKey)
      return result
    }

    return descriptor
  }
}
