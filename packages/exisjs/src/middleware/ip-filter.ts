import type { Handler, Request, Response, NextFunction } from '../types'
import { HttpError } from '../utils/errors'

export interface IpFilterOptions {
  /** List of IPs or CIDR blocks to allow. If provided, only these are allowed. */
  allow?: string[]
  /** List of IPs or CIDR blocks to block. Evaluated after allow. */
  deny?: string[]
  /** Custom error message when blocked */
  message?: string
  /** If true, trust X-Forwarded-For header (for apps behind a proxy). Default: true */
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

/** Resolve the real client IP, respecting X-Forwarded-For when behind a proxy */
function resolveIp(req: Request, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.get('x-forwarded-for')
    if (forwarded) {
      // X-Forwarded-For: client, proxy1, proxy2 — take the leftmost (true client)
      return forwarded.split(',')[0].trim()
    }
  }
  return req.ip || '127.0.0.1'
}

export function ipFilterMiddleware(options: IpFilterOptions = {}): Handler {
  const allowRules = options.allow ?? null
  const denyRules = options.deny ?? null
  const message = options.message ?? 'Access Denied'
  const trustProxy = options.trustProxy !== false // default true

  let nativeFilter: any = null
  let isFallback = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeIpFilter } = require('@exisjs/rs')
    nativeFilter = new NativeIpFilter(allowRules, denyRules)
  } catch {
    isFallback = true
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = resolveIp(req, trustProxy)

    if (!isFallback && nativeFilter) {
      if (!nativeFilter.check(ip)) {
        return next(HttpError.forbidden(message))
      }
      return next()
    }

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
