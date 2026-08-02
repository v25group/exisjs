import type { Handler } from '../types'
import type { ExisResponse } from '../server/response'
import type { ExisRequest } from '../server/request'

export interface IdempotencyStore {
  get(
    key: string
  ): Promise<{
    statusCode: number
    headers: Record<string, string>
    body: any
  } | null>
  set(
    key: string,
    data: { statusCode: number; headers: Record<string, string>; body: any },
    ttl?: number
  ): Promise<void>
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private cache = new Map<string, { data: any; expiry: number }>()

  async get(key: string) {
    const item = this.cache.get(key)
    if (!item) return null
    if (Date.now() > item.expiry) {
      this.cache.delete(key)
      return null
    }
    return item.data
  }

  async set(key: string, data: any, ttl = 86400000) {
    this.cache.set(key, { data, expiry: Date.now() + ttl })
  }
}

const defaultStore = new MemoryIdempotencyStore()

export interface IdempotentOptions {
  store?: IdempotencyStore
  headerName?: string
  ttl?: number
}

/**
 * Idempotency Middleware.
 * Caches responses based on the provided Idempotency-Key header.
 * Ideal for preventing duplicate checkout charges or identical mutations.
 */
export function Idempotent(options: IdempotentOptions = {}): Handler {
  const store = options.store || defaultStore
  const headerName = (options.headerName || 'Idempotency-Key').toLowerCase()
  const ttl = options.ttl || 86400000 // 24 hours

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
              ttl
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
