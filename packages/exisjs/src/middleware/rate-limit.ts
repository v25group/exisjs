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
  /** The key's hits in the current window without adding one; `undefined` if none */
  get?(
    key: string
  ): RateLimitHit | undefined | Promise<RateLimitHit | undefined>
  /** Forgets the key, e.g. clears a login lockout after a successful sign-in */
  reset?(key: string): void | Promise<void>
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

  get(key: string): RateLimitHit | undefined {
    const record = this.hits.get(key)
    if (!record || record.resetTime <= Date.now()) return undefined
    return { count: record.count, resetTime: record.resetTime }
  }

  reset(key: string): void {
    this.hits.delete(key)
  }
}

export interface ConsumeOptions {
  max: number
  windowMs: number
  message?: string
}

function tooMany(hit: RateLimitHit, message?: string): HttpError {
  const retryAfter = Math.max(1, Math.ceil((hit.resetTime - Date.now()) / 1000))
  return new HttpError(
    message || 'Too many requests, please try again later.',
    429,
    'RATE_LIMIT_EXCEEDED',
    { retryAfter }
  )
}

/**
 * Counts one hit for `key` and throws the standard 429 once it passes `max`.
 * For limits keyed on something only the handler knows, such as the email
 * of a login attempt (route middleware runs before the body is validated).
 *
 * @example Login lockout: refuse while locked, count failures, clear on success
 * ```ts
 * await assertNotLimited(store, `login:${email}`, { max: 5, windowMs: 15 * 60_000 })
 * if (!(await verifyPassword(user, password))) {
 *   await consume(store, `login:${email}`, { max: 5, windowMs: 15 * 60_000 })
 *   throw new HttpError('Invalid email or password', 401, 'UNAUTHORIZED')
 * }
 * await store.reset?.(`login:${email}`)
 * ```
 */
export async function consume(
  store: RateLimitStore,
  key: string,
  options: ConsumeOptions
): Promise<RateLimitHit> {
  const hit = await store.increment(key, options.windowMs)
  if (hit.count > options.max) throw tooMany(hit, options.message)
  return hit
}

/** Throws the standard 429 if `key` already reached `max`, without counting a hit. Needs `store.get`. */
export async function assertNotLimited(
  store: RateLimitStore,
  key: string,
  options: ConsumeOptions
): Promise<void> {
  if (!store.get) {
    throw new Error('assertNotLimited needs a RateLimitStore with get()')
  }
  const hit = await store.get(key)
  if (hit && hit.count >= options.max) throw tooMany(hit, options.message)
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
      const record = await store.increment(key, windowMs)
      const currentHits = record.count
      // Read after the store: it set resetTime from its own clock, so an
      // earlier reading would report one second too many on a slow store
      const now = Date.now()

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
