import type { Handler } from '../types'
import type { ExisResponse } from '../server/response'
import type { ExisRequest } from '../server/request'

export interface IdempotencyStore {
  get(key: string): Promise<{
    statusCode: number
    headers: Record<string, string>
    body: any
  } | null>
  set(
    key: string,
    data: { statusCode: number; headers: Record<string, string>; body: any },
    ttlMs?: number
  ): Promise<void>
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private nativeCache: any
  private fallbackCache = new Map<string, { data: any; expiry: number }>()
  private isFallback = false

  constructor() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { NativeMemoryCache } = require('@exisjs/rs')
      // Cap at 10,000 concurrent idempotent requests to prevent memory exhaustion
      this.nativeCache = new NativeMemoryCache(10000)
    } catch {
      this.isFallback = true
    }
  }

  async get(key: string) {
    if (!this.isFallback) {
      const dataStr = this.nativeCache.get(key)
      if (!dataStr) return null
      try {
        return JSON.parse(dataStr)
      } catch {
        return null
      }
    }

    const item = this.fallbackCache.get(key)
    if (!item) return null
    if (Date.now() > item.expiry) {
      this.fallbackCache.delete(key)
      return null
    }
    return item.data
  }

  async set(key: string, data: any, ttlMs = 86400000) {
    if (!this.isFallback) {
      this.nativeCache.set(key, JSON.stringify(data), ttlMs)
      return
    }

    this.fallbackCache.set(key, { data, expiry: Date.now() + ttlMs })
  }
}

const defaultStore = new MemoryIdempotencyStore()

export interface IdempotentOptions {
  store?: IdempotencyStore
  headerName?: string
  /** Time-to-live in milliseconds for cached idempotent responses. Default: 86400000 (24h) */
  ttlMs?: number
}

/**
 * Idempotency Middleware.
 * Caches responses based on the provided Idempotency-Key header.
 * Ideal for preventing duplicate checkout charges or identical mutations.
 */
export function idempotent(options: IdempotentOptions = {}): Handler {
  const store = options.store || defaultStore
  const headerName = (options.headerName || 'Idempotency-Key').toLowerCase()
  const ttlMs = options.ttlMs ?? 86400000 // 24 hours

  return async (
    req: ExisRequest<any, any, any>,
    res: ExisResponse,
    next: any
  ) => {
    const key = req.header(headerName)

    // If no key is provided, just continue normally
    if (!key) {
      return await next()
    }

    // Check if we have a cached response for this key
    const cached = await store.get(key)
    if (cached) {
      res.status(cached.statusCode)
      for (const [k, v] of Object.entries(cached.headers)) {
        res.setHeader(k, v as string)
      }
      return res.json(cached.body)
    }

    // Intercept the response
    const originalJson = res.json.bind(res)
    const originalSend = res.send.bind(res)

    let interceptedBody: any = undefined

    const cacheResponse = () => {
      if (
        (res.statusCode >= 200 && res.statusCode < 400) ||
        res.statusCode === undefined
      ) {
        if (interceptedBody !== undefined) {
          store
            .set(
              key,
              {
                statusCode: res.statusCode || 200,
                headers: { 'content-type': 'application/json; charset=utf-8' },
                body: interceptedBody,
              },
              ttlMs
            )
            .catch(console.error)
        }
      }
    }

    // Override json
    res.json = (body: any) => {
      interceptedBody = body
      const ret = originalJson(body)
      cacheResponse()
      return ret
    }

    // Override send
    res.send = (body: any) => {
      interceptedBody = body
      const ret = originalSend(body)
      cacheResponse()
      return ret
    }

    next()
  }
}

/** @deprecated Use `idempotent` (camelCase) instead */
export const Idempotent = idempotent
