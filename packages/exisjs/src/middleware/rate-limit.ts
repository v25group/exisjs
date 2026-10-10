import type { Request, Response, NextFunction, Handler } from '../types'
import { HttpError } from '../error/errors'

export interface RateLimitOptions {
  windowMs?: number // How long to keep records of requests in memory
  max?: number // Max number of connections during windowMs milliseconds before sending a 429 response
  message?: string // Error message sent to user when max is exceeded
  statusCode?: number // HTTP status code returned when max is exceeded
  keyGenerator?: (req: Request) => string // Function used to generate keys
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

  const hits = new Map<string, { count: number; resetTime: number }>()

  // Drop expired windows so idle keys do not accumulate
  const sweepInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, data] of hits.entries()) {
      if (data.resetTime <= now) {
        hits.delete(key)
      }
    }
  }, windowMs)
  sweepInterval.unref()

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = keyGenerator(req)
      const now = Date.now()

      let record = hits.get(key)
      if (!record || record.resetTime <= now) {
        record = { count: 0, resetTime: now + windowMs }
        hits.set(key, record)
      }
      record.count += 1
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
    } catch {
      // In case of unexpected error, bypass rate limiting rather than failing request
      next()
    }
  }
}
