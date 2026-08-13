export function mergeHeaders(
  ...parts: (Record<string, string> | undefined)[]
): Record<string, string> {
  return Object.assign({}, ...parts.filter(Boolean))
}

export function headersToRecord(h: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  h.forEach((v, k) => {
    out[k] = v
  })
  return out
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Read a cookie value by name (browser only). */
export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(
    new RegExp(
      `(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`
    )
  )
  return match ? decodeURIComponent(match[1]) : null
}
