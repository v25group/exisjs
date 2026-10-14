import type { Request, Response, NextFunction, Handler } from '../types'
import { HttpError } from '../error/errors'

export interface RateLimitOptions {
  windowMs?: number // How long to keep records of requests in memory
  max?: number // Max number of connections during windowMs milliseconds before sending a 429 response
  message?: string // Error message sent to user when max is exceeded
  statusCode?: number // HTTP status code returned when max is exceeded
  keyGenerator?: (req: Request) => string // Function used to generate keys
  /**
   * Where hits are counted. The default memory store counts per process, so
   * with several instances (or serverless) each one allows `max`. Pass a
   * shared store (Redis, a database) to enforce one limit across instances.
   */
  store?: RateLimitStore
}

export interface RateLimitHit {
  /** Hits in the current window, including this one */
  count: number
  /** When the window ends, in milliseconds since the epoch */
  resetTime: number
}

/**
 * Counts hits per key in fixed windows.
 *
 * @example Redis (ioredis or node-redis)
 * ```ts
 * const redisStore: RateLimitStore = {
 *   async increment(key, windowMs) {
 *     const k = `rl:${key}`
 *     const [[, count], [, ttl]] = await redis
 *       .multi().incr(k).pexpire(k, windowMs, 'NX').pttl(k).exec()
 *     return { count, resetTime: Date.now() + Math.max(ttl, 0) }
 *   },
 * }
 * ```
 */
export interface RateLimitStore {
  increment(key: string, windowMs: number): RateLimitHit | Promise<RateLimitHit>
}

/** Per-process store; idle keys are dropped once their window ends. */
export class MemoryRateLimitStore implements RateLimitStore {
  private hits = new Map<string, RateLimitHit>()
  private sweep?: NodeJS.Timeout

  increment(key: string, windowMs: number): RateLimitHit {
    if (!this.sweep) {
      this.sweep = setInterval(() => {
        const now = Date.now()
        for (const [k, data] of this.hits) {
          if (data.resetTime <= now) this.hits.delete(k)
        }
      }, windowMs)
      this.sweep.unref()
    }
    const now = Date.now()
    let record = this.hits.get(key)
    if (!record || record.resetTime <= now) {
      record = { count: 0, resetTime: now + windowMs }
      this.hits.set(key, record)
    }
    record.count += 1
    return { count: record.count, resetTime: record.resetTime }
  }
}

export function rateLimit(options: RateLimitOptions = {}): Handler {
  const windowMs = options.windowMs || 60000 // 1 minute
  const max = options.max || 100
  const message =
    options.message || 'Too many requests, please try again later.'
  const statusCode = options.statusCode || 429
  const keyGenerator =
    options.keyGenerator ||
    ((req: Request) => {
      // By default, use req.ip which represents the remote socket address.
      // Do not blindly trust x-forwarded-for headers as they can be spoofed by clients to bypass rate limits.
      // If the app is behind a reverse proxy, the user should configure the proxy settings on the app instance.
      return req.ip || 'unknown'
    })

  const store = options.store ?? new MemoryRateLimitStore()

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = keyGenerator(req)
      const now = Date.now()

      const record = await store.increment(key, windowMs)
      const currentHits = record.count

      // Report when this key's window actually ends, not a full window from now
      const resetSeconds = Math.max(
        1,
        Math.ceil((record.resetTime - now) / 1000)
      )
      const resetEpochSeconds = Math.ceil(record.resetTime / 1000)

      // Legacy Headers
      res.set('X-RateLimit-Limit', max.toString())
      res.set(
        'X-RateLimit-Remaining',
        Math.max(0, max - currentHits).toString()
      )
      res.set('X-RateLimit-Reset', resetEpochSeconds.toString())

      // IETF Draft Standard Headers
      res.set('RateLimit-Limit', max.toString())
      res.set('RateLimit-Remaining', Math.max(0, max - currentHits).toString())
      res.set('RateLimit-Reset', resetSeconds.toString())

      if (currentHits > max) {
        res.set('Retry-After', resetSeconds.toString())
        return next(new HttpError(message, statusCode, 'RATE_LIMIT_EXCEEDED'))
      }

      next()
    } catch (err) {
      // A store outage must not take the API down: let the request through
      req.log?.warn?.(
        { err },
        '[exis] Rate limit store failed; request allowed'
      )
      next()
    }
  }
}
