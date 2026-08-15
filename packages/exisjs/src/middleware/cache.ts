import type { Handler, Request, Response, NextFunction } from '../types'
import { getCacheStore, type CacheStore } from '../cache/store'

export interface CacheOptions {
  store?: CacheStore
  ttlMs?: number
  tags?: string[] | ((req: Request) => string[])
  /**
   * Function to generate a unique key per request.
   * Defaults to `req.method + req.path`.
   * Override this for user-scoped caching (e.g. `(req) => req.user.id + req.path`).
   */
  keyGenerator?: (req: Request) => string
  /**
   * Stale-While-Revalidate duration in milliseconds.
   * If the cache is older than ttlMs but younger than ttlMs + swrMs,
   * stale data is served instantly while it revalidates in the background.
   */
  swrMs?: number
}

// Global in-flight requests map to prevent Cache Stampedes (Dogpile effect)
const inFlightRequests = new Map<string, Promise<any>>()

export function cacheMiddleware(options: CacheOptions): Handler {
  const ttlMs = options.ttlMs
  if (!options || typeof options.keyGenerator !== 'function') {
    throw new Error(
      `cacheMiddleware: keyGenerator option is required to prevent cross-user data leaks.\nExample: cache({ ttlMs: 60000, keyGenerator: (req) => req.user?.id || req.ip })`
    )
  }
  const keyGenerator = options.keyGenerator

  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') {
      return next()
    }

    const store = options.store ?? getCacheStore()
    const key = keyGenerator(req)

    try {
      const cached = await store.get(key)
      if (cached) {
        const isStale = ttlMs && Date.now() - cached.createdAt > ttlMs

        // If it's stale and we have no SWR allowance, we act as a miss
        if (
          isStale &&
          (!options.swrMs ||
            Date.now() - cached.createdAt > ttlMs + options.swrMs)
        ) {
          // Treated as miss
        } else {
          // Handle Buffer reconstruction for Redis
          if (cached.data.contentType) {
            res.set('Content-Type', cached.data.contentType)
          }
          res.set('X-Exis-Cache', isStale ? 'STALE' : 'HIT')

          let bodyToSend = cached.data.body
          if (typeof cached.data.body === 'string' && cached.data.isBuffer) {
            bodyToSend = Buffer.from(cached.data.body, 'base64')
          }

          if (
            cached.data.contentType?.includes('application/json') &&
            typeof bodyToSend === 'string'
          ) {
            try {
              res.status(cached.data.statusCode).json(JSON.parse(bodyToSend))
            } catch {
              res.status(cached.data.statusCode).send(bodyToSend)
            }
          } else {
            res.status(cached.data.statusCode).send(bodyToSend)
          }

          if (!isStale) {
            return
          }
          // If it was stale, we returned the response already. Now we fall through
          // to trigger a background revalidation! We MUST NOT return here if stale.
        }
      }
    } catch {
      // Fallback to normal execution if cache read fails
    }

    // --- Cache Stampede Prevention ---
    // If another request is currently resolving this exact same cache key, we just wait for it.
    if (!res.headersSent) {
      if (inFlightRequests.has(key)) {
        res.set('X-Exis-Cache', 'DEDUPED')
        const dedupeResponse = await inFlightRequests.get(key)

        if (dedupeResponse.contentType) {
          res.set('Content-Type', dedupeResponse.contentType)
        }
        if (
          dedupeResponse.contentType?.includes('application/json') &&
          typeof dedupeResponse.body === 'string'
        ) {
          return res
            .status(dedupeResponse.statusCode)
            .json(JSON.parse(dedupeResponse.body))
        }
        return res.status(dedupeResponse.statusCode).send(dedupeResponse.body)
      }
    }

    // Set headers if not already sent (by SWR)
    if (!res.headersSent) {
      res.set('X-Exis-Cache', 'MISS')
    }

    let resolveInFlight: (val: any) => void
    const inFlightPromise = new Promise<any>((resolve) => {
      resolveInFlight = resolve
    })
    inFlightRequests.set(key, inFlightPromise)
    // --- End Stampede Prevention ---

    // Intercept send/json
    const originalSend = res.send.bind(res)
    const originalJson = res.json.bind(res)

    res.send = function (body: string | Buffer) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        let tags: string[] = []
        if (typeof options.tags === 'function') {
          tags = options.tags(req)
        } else if (options.tags) {
          tags = options.tags
        }

        const payload = {
          body,
          contentType:
            typeof (res as any).getHeader === 'function'
              ? (res as any).getHeader('content-type')
              : undefined,
          statusCode: res.statusCode,
          isBuffer: Buffer.isBuffer(body),
        }

        Promise.resolve(store.set(key, payload, tags, ttlMs)).catch(() => {
          /* noop */
        })

        resolveInFlight!(payload)
        inFlightRequests.delete(key)
      } else {
        resolveInFlight!({})
        inFlightRequests.delete(key)
      }

      if (!res.headersSent) {
        return originalSend(body)
      }
    }

    res.json = function (data: unknown) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        let tags: string[] = []
        if (typeof options.tags === 'function') {
          tags = options.tags(req)
        } else if (options.tags) {
          tags = options.tags
        }

        const payload = {
          body: JSON.stringify(data),
          contentType: 'application/json; charset=utf-8',
          statusCode: res.statusCode,
          isBuffer: false,
        }

        Promise.resolve(store.set(key, payload, tags, ttlMs)).catch(() => {
          /* noop */
        })

        resolveInFlight!(payload)
        inFlightRequests.delete(key)
      } else {
        resolveInFlight!({})
        inFlightRequests.delete(key)
      }

      if (!res.headersSent) {
        return originalJson(data)
      }
    }

    next()
  }
}
