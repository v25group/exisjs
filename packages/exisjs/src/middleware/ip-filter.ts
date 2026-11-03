import { BlockList, isIP } from 'node:net'
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

const family = (ip: string): 'ipv4' | 'ipv6' =>
  isIP(ip) === 6 ? 'ipv6' : 'ipv4'

/**
 * Compiles the rules once. A rule that can't be read stops the start: ignoring
 * it would silently leave a deny list open or an allow list wrong.
 */
function compileRules(rules: string[]): BlockList {
  const list = new BlockList()
  for (const rule of rules) {
    const [address, prefix] = rule.split('/')
    const version = isIP(address)
    const bits = Number(prefix)
    const validPrefix =
      prefix === undefined ||
      (/^\d+$/.test(prefix) && bits <= (version === 6 ? 128 : 32))
    if (version === 0 || !validPrefix) {
      throw new Error(
        `[ExisJS] ipFilter: '${rule}' is not an IP address or CIDR block`
      )
    }
    if (prefix === undefined) list.addAddress(address, family(address))
    else list.addSubnet(address, bits, family(address))
  }
  return list
}

function matches(list: BlockList, ip: string): boolean {
  return isIP(ip) !== 0 && list.check(ip, family(ip))
}

export function ipFilterMiddleware(options: IpFilterOptions = {}): Handler {
  const allowRules = options.allow ? compileRules(options.allow) : null
  const denyRules = options.deny ? compileRules(options.deny) : null
  const message = options.message ?? 'Access Denied'

  return (req: Request, res: Response, next: NextFunction) => {
    // req.ip only honours X-Forwarded-For for proxies the app trusts; reading
    // the header here would let any client claim an allowed address.
    // An unknown address is '' so it can never match an allow rule.
    const ip = req.ip || ''

    // If allowlist is defined, IP MUST match at least one rule
    if (allowRules !== null && !matches(allowRules, ip)) {
      return next(HttpError.forbidden(message))
    }

    // If denylist is defined, IP MUST NOT match any rule
    if (denyRules !== null && matches(denyRules, ip)) {
      return next(HttpError.forbidden(message))
    }

    next()
  }
}

export const ipFilter = ipFilterMiddleware
