import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

export interface CacheItem {
  data: any
  tags: string[]
  createdAt: number
}

export interface CacheStore {
  get(key: string): Promise<CacheItem | null>
  set(key: string, data: any, tags: string[], ttlMs?: number): Promise<void>
  revalidateTag(tag: string): Promise<void>
  getTags(): Promise<Record<string, number>>
}

export class FileSystemCacheStore implements CacheStore {
  private cacheDir: string
  private tagsPath: string

  constructor(cwd: string) {
    this.cacheDir = path.join(cwd, '.exis', 'cache')
    this.tagsPath = path.join(this.cacheDir, 'tags.json')
  }

  private async ensureDir() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true })
    } catch {
      /* ignore */
    }
  }

  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex')
  }

  async getTags(): Promise<Record<string, number>> {
    try {
      const data = await fs.readFile(this.tagsPath, 'utf8')
      return JSON.parse(data)
    } catch {
      return {}
    }
  }

  async get(key: string): Promise<CacheItem | null> {
    const hash = this.hashKey(key)
    const itemPath = path.join(this.cacheDir, `${hash}.json`)

    try {
      const data = await fs.readFile(itemPath, 'utf8')
      const item: CacheItem = JSON.parse(data)

      const tags = await this.getTags()

      // Check if stale via tags
      for (const tag of item.tags) {
        if (tags[tag] && tags[tag] > item.createdAt) {
          // It's stale!
          return null
        }
      }

      return item
    } catch {
      return null
    }
  }

  async set(
    key: string,
    data: any,
    tags: string[],
    _ttlMs?: number
  ): Promise<void> {
    await this.ensureDir()
    const hash = this.hashKey(key)
    const itemPath = path.join(this.cacheDir, `${hash}.json`)
    const item: CacheItem = {
      data,
      tags,
      createdAt: Date.now(),
    }
    await fs.writeFile(itemPath, JSON.stringify(item), 'utf8')
  }

  async revalidateTag(tag: string): Promise<void> {
    await this.ensureDir()
    const tags = await this.getTags()
    tags[tag] = Date.now()
    await fs.writeFile(this.tagsPath, JSON.stringify(tags), 'utf8')
  }
}

export class MemoryCacheStore implements CacheStore {
  private cache: any
  private isWorker: boolean

  constructor(capacity = 10000) {
    // Dynamically load to avoid issues if native module fails in some environments
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeCache } = require('@exisjs/rs')
    this.cache = new NativeCache(capacity)
    this.isWorker =
      process.env.__EXIS_CLUSTER_WORKERS !== undefined &&
      process.send !== undefined

    if (this.isWorker) {
      process.on('message', (msg: any) => {
        if (msg && msg.type === 'exis:cache:revalidate' && msg.tag) {
          this.cache.revalidateTag(msg.tag)
        }
      })
    }
  }

  async get(key: string): Promise<CacheItem | null> {
    const data = this.cache.get(key)
    if (!data) return null
    try {
      return JSON.parse(data)
    } catch {
      return null
    }
  }

  async set(
    key: string,
    data: any,
    tags: string[],
    _ttlMs?: number
  ): Promise<void> {
    try {
      const dataJson = JSON.stringify(data)
      this.cache.set(key, dataJson, tags)
    } catch {
      // Ignore serialization errors
    }
  }

  async revalidateTag(tag: string): Promise<void> {
    this.cache.revalidateTag(tag)

    if (this.isWorker && process.send) {
      process.send({
        type: 'exis:cache:revalidate',
        tag,
      })
    }
  }

  async getTags(): Promise<Record<string, number>> {
    try {
      const data = this.cache.getTags()
      if (!data) return {}
      return JSON.parse(data)
    } catch {
      return {}
    }
  }
}

export interface MinimalRedisClient {
  get(key: string): Promise<string | null>
  set(
    key: string,
    value: string,
    mode: string,
    duration: number
  ): Promise<unknown>
  del(key: string): Promise<number>
  flushdb(): Promise<unknown>
}

export class RedisCacheStore implements CacheStore {
  private client: MinimalRedisClient
  private prefix: string

  constructor(client: MinimalRedisClient, prefix = 'exis:cache:') {
    this.client = client
    this.prefix = prefix
  }

  async getTags(): Promise<Record<string, number>> {
    try {
      const data = await this.client.get(this.prefix + 'tags')
      if (!data) return {}
      return JSON.parse(data)
    } catch {
      return {}
    }
  }

  async get(key: string): Promise<CacheItem | null> {
    try {
      const data = await this.client.get(this.prefix + key)
      if (!data) return null
      const item: CacheItem = JSON.parse(data)

      const tags = await this.getTags()
      for (const tag of item.tags) {
        if (tags[tag] && tags[tag] > item.createdAt) {
          return null
        }
      }
      return item
    } catch {
      return null
    }
  }

  async set(
    key: string,
    data: any,
    tags: string[],
    ttlMs?: number
  ): Promise<void> {
    try {
      const item: CacheItem = {
        data,
        tags,
        createdAt: Date.now(),
      }
      const serialized = JSON.stringify(item)
      if (ttlMs) {
        await this.client.set(this.prefix + key, serialized, 'PX', ttlMs)
      } else {
        // Without TTL, just set it, but MinimalRedisClient signature requires 'PX' and duration.
        // So we'll default to 30 days if no TTL is provided
        await this.client.set(
          this.prefix + key,
          serialized,
          'PX',
          30 * 24 * 60 * 60 * 1000
        )
      }
    } catch {
      // Ignore
    }
  }

  async revalidateTag(tag: string): Promise<void> {
    try {
      const tags = await this.getTags()
      tags[tag] = Date.now()
      await this.client.set(
        this.prefix + 'tags',
        JSON.stringify(tags),
        'PX',
        30 * 24 * 60 * 60 * 1000
      )
    } catch {
      // Ignore
    }
  }
}

export class TieredCacheStore implements CacheStore {
  constructor(
    private local: CacheStore,
    private remote: CacheStore
  ) {}

  async get(key: string): Promise<CacheItem | null> {
    const localItem = await this.local.get(key)
    if (localItem) return localItem

    const remoteItem = await this.remote.get(key)
    if (remoteItem) {
      // Background sync back to local cache
      Promise.resolve(
        this.local.set(key, remoteItem.data, remoteItem.tags, undefined) // TTL logic omitted for sync simplicity
      ).catch(() => {
        /* noop */
      })
      return remoteItem
    }
    return null
  }

  async set(
    key: string,
    data: any,
    tags: string[],
    ttlMs?: number
  ): Promise<void> {
    await Promise.all([
      this.local.set(key, data, tags, ttlMs),
      this.remote.set(key, data, tags, ttlMs),
    ])
  }

  async revalidateTag(tag: string): Promise<void> {
    await Promise.all([
      this.local.revalidateTag(tag),
      this.remote.revalidateTag(tag),
    ])
  }

  async getTags(): Promise<Record<string, number>> {
    // Rely on remote for tags to ensure consistency across fleet
    return this.remote.getTags()
  }
}

// Global active store singleton
let activeStore: CacheStore | null = null

export function getCacheStore(): CacheStore {
  if (!activeStore) {
    let memoryStore: CacheStore
    if (process.env.NODE_ENV === 'production') {
      memoryStore = new MemoryCacheStore(100000)
    } else {
      memoryStore = new FileSystemCacheStore(process.cwd())
    }

    // If REDIS_URL is present, automatically compose a TieredCacheStore
    if (process.env.REDIS_URL) {
      // Lazy load redis to avoid cold start overhead if not used
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Redis = require('ioredis')
      const redisClient = new Redis(process.env.REDIS_URL)
      activeStore = new TieredCacheStore(
        memoryStore,
        new RedisCacheStore(redisClient)
      )
    } else {
      activeStore = memoryStore
    }
  }
  return activeStore
}

export function setCacheStore(store: CacheStore) {
  activeStore = store
}
