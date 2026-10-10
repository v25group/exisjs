import type { CookieOptions } from '../../types'

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {}
): string {
  const parts: string[] = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
  ]

  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`)
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`)
  if (options.path ?? true) parts.push(`Path=${options.path ?? '/'}`)
  if (options.domain) parts.push(`Domain=${options.domain}`)
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')

  if (options.sameSite !== undefined && options.sameSite !== false) {
    if (options.sameSite === true) {
      parts.push('SameSite=Strict')
    } else {
      const str = String(options.sameSite).toLowerCase()
      if (str === 'strict') parts.push('SameSite=Strict')
      else if (str === 'lax') parts.push('SameSite=Lax')
      else if (str === 'none') {
        parts.push('SameSite=None')
        if (!options.secure && !parts.includes('Secure')) {
          parts.push('Secure')
        }
      }
    }
  }

  if (options.partitioned) parts.push('Partitioned')
  if (options.priority) {
    const p = options.priority.toLowerCase()
    if (p === 'low') parts.push('Priority=Low')
    else if (p === 'medium') parts.push('Priority=Medium')
    else if (p === 'high') parts.push('Priority=High')
  }

  return parts.join('; ')
}

export function serializeClearCookie(
  name: string,
  options: CookieOptions = {}
): string {
  const { maxAge: _, expires: __, ...rest } = options
  return serializeCookie(name, '', {
    httpOnly: true,
    ...rest,
    expires: new Date(0),
    maxAge: 0,
  })
}

/**
 * Parses a Cookie header. The first occurrence of a name wins, values are
 * percent-decoded when needed, and a malformed escape keeps the raw value
 * rather than failing the request.
 */
export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  let start = 0
  const len = header.length
  while (start < len) {
    let end = header.indexOf(';', start)
    if (end === -1) end = len
    const eq = header.indexOf('=', start)
    if (eq !== -1 && eq < end) {
      const key = header.slice(start, eq).trim()
      // "__proto__" would hit the prototype setter instead of a property
      if (key !== '' && key !== '__proto__' && out[key] === undefined) {
        let val = header.slice(eq + 1, end).trim()
        if (val.indexOf('%') !== -1) {
          try {
            val = decodeURIComponent(val)
          } catch {
            // keep raw value
          }
        }
        out[key] = val
      }
    }
    start = end + 1
  }
  return out
}
