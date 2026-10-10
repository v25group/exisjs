// Bounded in-memory TTL cache. Entries expire lazily on read; when full, the
// least recently written entry is evicted (Map keeps insertion order), so
// memory stays capped no matter how many distinct keys clients send.
export class TtlCache<V> {
  private entries = new Map<string, { value: V; expires: number }>()

  constructor(private readonly maxEntries: number) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    if (Date.now() > entry.expires) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: V, ttlMs: number): void {
    this.entries.delete(key)
    this.entries.set(key, { value, expires: Date.now() + ttlMs })
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}
