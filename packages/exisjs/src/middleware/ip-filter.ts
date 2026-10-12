import type { Handler, Request, Response, NextFunction } from '../types'
import { HttpError } from '../error/errors'

export interface IpFilterOptions {
  /** List of IPs or CIDR blocks to allow. If provided, only these are allowed. */
  allow?: string[]
  /** List of IPs or CIDR blocks to block. Evaluated after allow. */
  deny?: string[]
  /** Custom error message when blocked */
  message?: string
  /**
   * @deprecated Ignored. The client IP is `req.ip`, which follows the app-level
   * `trustProxy` setting in `exis.config.ts`.
   */
  trustProxy?: boolean
}

/** Parse a CIDR block into network address and mask */
function parseCidr(cidr: string): { network: number; mask: number } | null {
  const [ip, prefix] = cidr.split('/')
  if (!prefix) return null
  const bits = parseInt(prefix, 10)
  if (isNaN(bits) || bits < 0 || bits > 32) return null
  const network = ipToInt(ip)
  if (network === null) return null
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return { network: (network & mask) >>> 0, mask }
}

/** Convert dotted-decimal IP to 32-bit integer */
function ipToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let val = 0
  for (const part of parts) {
    const n = parseInt(part, 10)
    if (isNaN(n) || n < 0 || n > 255) return null
    val = (val << 8) | n
  }
  return val >>> 0
}

/** Check if an IP matches a rule (exact string or CIDR) */
function ipMatchesRule(ip: string, rule: string): boolean {
  if (rule.includes('/')) {
    const cidr = parseCidr(rule)
    if (!cidr) return false
    const ipInt = ipToInt(ip)
    if (ipInt === null) return false
    return (ipInt & cidr.mask) >>> 0 === cidr.network
  }
  return ip === rule
}

function ipMatchesAny(ip: string, rules: string[]): boolean {
  return rules.some((rule) => ipMatchesRule(ip, rule))
}

export function ipFilterMiddleware(options: IpFilterOptions = {}): Handler {
  const allowRules = options.allow ?? null
  const denyRules = options.deny ?? null
  const message = options.message ?? 'Access Denied'

  return (req: Request, res: Response, next: NextFunction) => {
    // req.ip only honours X-Forwarded-For for proxies the app trusts; reading
    // the header here would let any client claim an allowed address.
    // An unknown address is '' so it can never match an allow rule.
    const ip = req.ip || ''

    // If allowlist is defined, IP MUST match at least one rule
    if (allowRules !== null) {
      if (!ipMatchesAny(ip, allowRules)) {
        return next(HttpError.forbidden(message))
      }
    }

    // If denylist is defined, IP MUST NOT match any rule
    if (denyRules !== null) {
      if (ipMatchesAny(ip, denyRules)) {
        return next(HttpError.forbidden(message))
      }
    }

    next()
  }
}

export const ipFilter = ipFilterMiddleware
