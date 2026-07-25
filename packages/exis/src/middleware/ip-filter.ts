import type { Handler, Request, Response, NextFunction } from '../types'
import { HttpError } from '../utils/errors'

export interface IpFilterOptions {
  /** List of exact IP addresses to allow. If provided, only these IPs are allowed. */
  allowlist?: string[]
  /** List of exact IP addresses to block. Evaluated after allowlist. */
  denylist?: string[]
  /** Custom error message when blocked */
  message?: string
}

export function ipFilterMiddleware(options: IpFilterOptions = {}): Handler {
  const allowSet = options.allowlist ? new Set(options.allowlist) : null
  const denySet = options.denylist ? new Set(options.denylist) : null
  const message = options.message ?? 'Access Denied'

  return (req: Request, res: Response, next: NextFunction) => {
    // Get client IP, falling back to localhost if unknown
    const ip = req.ip || '127.0.0.1'

    // If allowlist is defined, IP MUST be in the allowlist
    if (allowSet !== null) {
      if (!allowSet.has(ip)) {
        return next(HttpError.forbidden(message))
      }
    }

    // If denylist is defined, IP MUST NOT be in the denylist
    if (denySet !== null) {
      if (denySet.has(ip)) {
        return next(HttpError.forbidden(message))
      }
    }

    next()
  }
}
