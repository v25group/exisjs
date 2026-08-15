import type { Request, Response, NextFunction, Handler } from '../types'
import { HttpError } from '../utils/errors'

export interface RateLimitOptions {
  windowMs?: number // How long to keep records of requests in memory
  max?: number // Max number of connections during windowMs milliseconds before sending a 429 response
  message?: string // Error message sent to user when max is exceeded
  statusCode?: number // HTTP status code returned when max is exceeded
  keyGenerator?: (req: Request) => string // Function used to generate keys
  redis?: any // Optional ioredis client
  prefix?: string // Redis key prefix
}

export function rateLimit(options: RateLimitOptions = {}): Handler {
  const windowMs = options.windowMs || 60000 // 1 minute
  const max = options.max || 100
  const message =
    options.message || 'Too many requests, please try again later.'
  const statusCode = options.statusCode || 429
  const prefix = options.prefix || 'rl:'
  const keyGenerator =
    options.keyGenerator ||
    ((req: Request) => {
      // By default, use req.ip which represents the remote socket address.
      // Do not blindly trust x-forwarded-for headers as they can be spoofed by clients to bypass rate limits.
      // If the app is behind a reverse proxy, the user should configure the proxy settings on the app instance.
      return req.ip || 'unknown'
    })

  // Initialize the native rate limiter. Fallback to a JS Map if the native module fails to load in a strange environment.
  let nativeLimiter: any = null
  const fallbackHits = new Map<string, { count: number; resetTime: number }>()

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeRateLimiter } = require('@exisjs/rs')
    nativeLimiter = new NativeRateLimiter(windowMs)

    // Sweep native memory periodically via background Rust thread
    const sweepInterval = setInterval(() => {
      nativeLimiter.sweep()
    }, windowMs)
    sweepInterval.unref()
  } catch {
    // Sweep JS memory fallback
    const sweepInterval = setInterval(() => {
      const now = Date.now()
      for (const [key, data] of fallbackHits.entries()) {
        if (data.resetTime <= now) {
          fallbackHits.delete(key)
        }
      }
    }, windowMs)
    sweepInterval.unref()
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = keyGenerator(req)
      const now = Date.now()

      let currentHits = 0

      if (options.redis) {
        const redisKey = `${prefix}${key}`
        const multi = options.redis.multi()
        multi.incr(redisKey)
        multi.pexpire(redisKey, windowMs)
        const results = await multi.exec()
        if (!results || results.length === 0) {
          throw new Error('Redis multi failed')
        }
        currentHits = results[0][1] as number
      } else if (nativeLimiter) {
        currentHits = nativeLimiter.hit(key)
      } else {
        let record = fallbackHits.get(key)
        if (!record || record.resetTime <= now) {
          record = { count: 0, resetTime: now + windowMs }
        }
        record.count += 1
        fallbackHits.set(key, record)
        currentHits = record.count
      }

      res.set('X-RateLimit-Limit', max.toString())
      res.set(
        'X-RateLimit-Remaining',
        Math.max(0, max - currentHits).toString()
      )

      if (currentHits > max) {
        return next(new HttpError(message, statusCode, 'RATE_LIMIT_EXCEEDED'))
      }

      next()
    } catch {
      // In case of error (e.g. redis failure), bypass rate limiting rather than failing request
      next()
    }
  }
}
