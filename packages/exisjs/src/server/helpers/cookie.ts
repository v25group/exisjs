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
