import type { IncomingMessage } from 'node:http'

export function normalizeIp(ip: string): string {
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7)
  }
  if (ip === '::1') {
    return '127.0.0.1'
  }
  return ip
}

// Env overrides are read once; process.env access is slow on the hot path.
let envTrust: boolean | undefined
function envTrustsProxy(): boolean {
  if (envTrust === undefined) {
    envTrust =
      process.env.TRUST_PROXY === 'true' ||
      process.env.EXIS_TRUST_PROXY === 'true'
  }
  return envTrust
}

function isProxyTrusted(trustProxy: boolean | number): boolean {
  return Boolean(trustProxy) || envTrustsProxy()
}

function firstHeader(val: string | string[] | undefined): string | undefined {
  const v = Array.isArray(val) ? val[0] : val
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t === '' ? undefined : t
}

/**
 * Resolves the client IP.
 *
 * - `trustProxy: false` -> socket address only.
 * - `trustProxy: true`  -> trust every hop: CDN headers (CF-Connecting-IP,
 *   True-Client-IP, X-Real-IP, X-Client-IP), else the left-most
 *   X-Forwarded-For entry. Only safe when every request passes through a
 *   proxy that overwrites these headers.
 * - `trustProxy: N`     -> trust the N closest hops, counting the socket peer
 *   (Express semantics). The client is the entry N steps back from the
 *   socket, so values a client prepends to X-Forwarded-For are ignored.
 *   CDN headers are not consulted, since any client can send them.
 */
export function resolveIps(
  raw: IncomingMessage,
  trustProxy: boolean | number
): { ips: string[]; ip: string } {
  const rawRemote = raw.socket?.remoteAddress ?? '127.0.0.1'
  const remoteAddress = normalizeIp(rawRemote)

  if (!isProxyTrusted(trustProxy)) {
    return { ips: [], ip: remoteAddress }
  }

  const hops =
    typeof trustProxy === 'number' && trustProxy > 0 ? trustProxy : Infinity

  if (hops === Infinity) {
    const h = raw.headers
    const direct =
      firstHeader(h['cf-connecting-ip']) ||
      firstHeader(h['true-client-ip']) ||
      firstHeader(h['x-real-ip']) ||
      firstHeader(h['x-client-ip'])
    if (direct) {
      const ip = normalizeIp(direct)
      return { ips: [ip], ip }
    }
  }

  const xForwardedFor = raw.headers['x-forwarded-for']
  if (!xForwardedFor) return { ips: [], ip: remoteAddress }

  const rawVal = Array.isArray(xForwardedFor)
    ? xForwardedFor.join(',')
    : xForwardedFor
  const forwarded: string[] = []
  for (const part of rawVal.split(',')) {
    const t = part.trim()
    if (t !== '') forwarded.push(normalizeIp(t))
  }
  if (forwarded.length === 0) return { ips: [], ip: remoteAddress }

  if (hops === Infinity) {
    return { ips: forwarded, ip: forwarded[0] }
  }

  // Full chain as seen from the server: [...forwarded, socketPeer].
  // Trusting N hops means the client sits at index (length - 1 - N).
  const chainLen = forwarded.length + 1
  const clientIdx = Math.max(0, chainLen - 1 - hops)
  const ips = forwarded.slice(clientIdx)
  return { ips, ip: forwarded[clientIdx] }
}

export function resolveProtocol(
  raw: IncomingMessage,
  trustProxy: boolean | number
): string {
  const isTrusted = isProxyTrusted(trustProxy)

  const connection = raw.socket as import('node:net').Socket & {
    encrypted?: boolean
  }
  const isTls = connection?.encrypted || false
  let protocol = isTls ? 'https' : 'http'

  if (isTrusted) {
    const cfVisitor = raw.headers['cf-visitor']
    if (typeof cfVisitor === 'string') {
      try {
        const parsed = JSON.parse(cfVisitor)
        if (parsed.scheme) return parsed.scheme
      } catch {
        // ignore
      }
    }

    const xForwardedProto = raw.headers['x-forwarded-proto']
    if (xForwardedProto) {
      const rawProto = Array.isArray(xForwardedProto)
        ? xForwardedProto.join(',')
        : xForwardedProto
      protocol = rawProto.split(',')[0].trim()
    }
  }
  return protocol
}

export function resolveHostname(
  raw: IncomingMessage,
  trustProxy: boolean | number
): string {
  const isTrusted = isProxyTrusted(trustProxy)

  let host = raw.headers['x-forwarded-host']
  if (!host || !isTrusted) {
    host = raw.headers.host || ''
  }
  if (Array.isArray(host)) host = host[0]

  // IPv6 can have colons, so look for port after bracket or last colon
  const offset = host[0] === '[' ? host.indexOf(']') + 1 : 0
  const index = host.indexOf(':', offset)
  return index !== -1 ? host.substring(0, index) : host
}
