export type BatchLoadFn<K, V> = (
  keys: readonly K[]
) => Promise<readonly (V | Error)[]>

export interface DataloaderOptions<K, C = K> {
  cache?: boolean
  maxBatchSize?: number
  cacheKeyFn?: (key: K) => C
}

export class Dataloader<K, V, C = K> {
  private cacheMap = new Map<C, Promise<V>>()
  private queue: {
    key: K
    resolve: (val: V) => void
    reject: (err: Error) => void
  }[] = []
  private dispatchScheduled = false

  constructor(
    private batchFn: BatchLoadFn<K, V>,
    private options: DataloaderOptions<K, C> = {}
  ) {}

  private getCacheKey(key: K): C {
    if (this.options.cacheKeyFn) {
      return this.options.cacheKeyFn(key)
    }
    // Default fallback: if key is an object, stringify it to prevent reference-equality cache misses
    if (typeof key === 'object' && key !== null) {
      return JSON.stringify(key) as unknown as C
    }
    return key as unknown as C
  }

  load(key: K): Promise<V> {
    const shouldCache = this.options.cache !== false
    const cacheKey = this.getCacheKey(key)

    if (shouldCache && this.cacheMap.has(cacheKey)) {
      return this.cacheMap.get(cacheKey)!
    }

    const promise = new Promise<V>((resolve, reject) => {
      this.queue.push({ key, resolve, reject })
    })

    if (shouldCache) {
      this.cacheMap.set(cacheKey, promise)
    }

    if (!this.dispatchScheduled) {
      this.dispatchScheduled = true
      process.nextTick(() => this.dispatch())
    }

    return promise
  }

  loadMany(keys: readonly K[]): Promise<V[]> {
    return Promise.all(keys.map((key) => this.load(key)))
  }

  clear(key: K): this {
    this.cacheMap.delete(this.getCacheKey(key))
    return this
  }

  clearAll(): this {
    this.cacheMap.clear()
    return this
  }

  prime(key: K, value: V | Error): this {
    const cacheKey = this.getCacheKey(key)
    if (!this.cacheMap.has(cacheKey)) {
      const promise =
        value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
      this.cacheMap.set(cacheKey, promise)
    }
    return this
  }

  private async dispatch() {
    this.dispatchScheduled = false
    const queue = this.queue
    this.queue = []

    if (queue.length === 0) return

    const maxBatchSize = this.options.maxBatchSize || 1000

    // Split into batches if needed
    for (let i = 0; i < queue.length; i += maxBatchSize) {
      const batch = queue.slice(i, i + maxBatchSize)
      this.dispatchBatch(batch)
    }
  }

  private async dispatchBatch(
    batch: { key: K; resolve: (val: V) => void; reject: (err: Error) => void }[]
  ) {
    const keys = batch.map((q) => q.key)

    try {
      const results = await this.batchFn(keys)

      if (!Array.isArray(results) || results.length !== keys.length) {
        throw new Error(
          'Dataloader batch function must return an array of the same length as the keys array'
        )
      }

      for (let i = 0; i < batch.length; i++) {
        const result = results[i]
        if (result instanceof Error) {
          batch[i].reject(result)
        } else {
          batch[i].resolve(result as V)
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      for (const q of batch) {
        q.reject(error)
      }
    }
  }
}
