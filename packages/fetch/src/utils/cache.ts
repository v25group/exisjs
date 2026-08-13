import type { FetchResponse } from '../types'

interface CacheEntry {
  response: FetchResponse
  expiry: number
}

/** Simple TTL-based in-memory cache, exposed on every client as `client.cache`. */
export class MemoryCache {
  private store = new Map<string, CacheEntry>()

  public get(key: string): FetchResponse | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiry) {
      this.store.delete(key)
      return undefined
    }
    return entry.response
  }

  public set(key: string, response: FetchResponse, ttlMs: number): void {
    this.store.set(key, { response, expiry: Date.now() + ttlMs })
  }

  public delete(key: string): void {
    this.store.delete(key)
  }

  public clear(): void {
    this.store.clear()
  }

  public get size(): number {
    return this.store.size
  }
}
