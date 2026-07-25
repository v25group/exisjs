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
  private items = new Map<string, CacheItem>()
  private tags: Record<string, number> = {}

  async get(key: string): Promise<CacheItem | null> {
    const item = this.items.get(key)
    if (!item) return null

    for (const tag of item.tags) {
      if (this.tags[tag] && this.tags[tag] > item.createdAt) {
        return null
      }
    }
    return item
  }

  async set(
    key: string,
    data: any,
    tags: string[],
    _ttlMs?: number
  ): Promise<void> {
    this.items.set(key, { data, tags, createdAt: Date.now() })
  }

  async revalidateTag(tag: string): Promise<void> {
    this.tags[tag] = Date.now()
  }

  async getTags(): Promise<Record<string, number>> {
    return this.tags
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

// Global active store singleton
let activeStore: CacheStore | null = null

export function getCacheStore(): CacheStore {
  if (!activeStore) {
    activeStore = new FileSystemCacheStore(process.cwd())
  }
  return activeStore
}

export function setCacheStore(store: CacheStore) {
  activeStore = store
}
