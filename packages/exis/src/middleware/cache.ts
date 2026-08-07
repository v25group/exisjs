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
}

export function cacheMiddleware(options: CacheOptions): Handler {
  const ttlMs = options.ttlMs
  // Default to method + path — safe for public, non-user-specific endpoints
  const keyGenerator =
    options.keyGenerator ?? ((req: Request) => `${req.method}:${req.path}`)

  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') {
      return next()
    }

    const store = options.store ?? getCacheStore()
    const key = keyGenerator(req)

    try {
      const cached = await store.get(key)
      if (cached) {
        if (cached.data.contentType) {
          res.set('Content-Type', cached.data.contentType)
        }
        res.set('X-Exis-Cache', 'HIT')

        let bodyToSend = cached.data.body
        // Handle Buffer reconstruction for Redis
        if (typeof cached.data.body === 'string' && cached.data.isBuffer) {
          bodyToSend = Buffer.from(cached.data.body, 'base64')
        }

        // For JSON responses, replay via res.json() so middleware chains
        // (interceptor, dedupe) receive the correct type instead of raw strings
        const ct = cached.data.contentType || ''
        if (ct.includes('application/json') && typeof bodyToSend === 'string') {
          try {
            res.status(cached.data.statusCode).json(JSON.parse(bodyToSend))
          } catch {
            // If parsing fails, fall back to send
            res.status(cached.data.statusCode).send(bodyToSend)
          }
        } else {
          res.status(cached.data.statusCode).send(bodyToSend)
        }
        return
      }
    } catch {
      // Fallback to normal execution if cache read fails
    }

    res.set('X-Exis-Cache', 'MISS')

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

        // Fire and forget caching
        Promise.resolve(
          store.set(
            key,
            {
              body,
              contentType:
                typeof (res as any).getHeader === 'function'
                  ? (res as any).getHeader('content-type')
                  : undefined,
              statusCode: res.statusCode,
              isBuffer: Buffer.isBuffer(body),
            },
            tags,
            ttlMs
          )
        ).catch(() => {
          /* noop */
        })
      }
      return originalSend(body)
    }

    res.json = function (data: unknown) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        let tags: string[] = []
        if (typeof options.tags === 'function') {
          tags = options.tags(req)
        } else if (options.tags) {
          tags = options.tags
        }

        Promise.resolve(
          store.set(
            key,
            {
              body: JSON.stringify(data),
              contentType: 'application/json; charset=utf-8',
              statusCode: res.statusCode,
              isBuffer: false,
            },
            tags,
            ttlMs
          )
        ).catch(() => {
          /* noop */
        })
      }
      return originalJson(data)
    }

    next()
  }
}
