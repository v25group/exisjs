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

export function resolveIps(
  raw: IncomingMessage,
  trustProxy: boolean | number
): { ips: string[]; ip: string } {
  const isTrusted =
    Boolean(trustProxy) ||
    process.env.TRUST_PROXY === 'true' ||
    process.env.EXIS_TRUST_PROXY === 'true'

  const rawRemote = raw.socket?.remoteAddress ?? '127.0.0.1'
  const remoteAddress = normalizeIp(rawRemote)

  if (!isTrusted) {
    return { ips: [], ip: remoteAddress }
  }

  // 1. Direct Edge & CDN client IP headers
  const cfConnectingIp = raw.headers['cf-connecting-ip']
  if (cfConnectingIp) {
    const rawVal = Array.isArray(cfConnectingIp)
      ? cfConnectingIp[0]
      : cfConnectingIp
    if (typeof rawVal === 'string' && rawVal.trim() !== '') {
      const ip = normalizeIp(rawVal.trim())
      return { ips: [ip], ip }
    }
  }

  const trueClientIp = raw.headers['true-client-ip']
  if (trueClientIp) {
    const rawVal = Array.isArray(trueClientIp) ? trueClientIp[0] : trueClientIp
    if (typeof rawVal === 'string' && rawVal.trim() !== '') {
      const ip = normalizeIp(rawVal.trim())
      return { ips: [ip], ip }
    }
  }

  const xRealIp = raw.headers['x-real-ip']
  if (xRealIp) {
    const rawVal = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp
    if (typeof rawVal === 'string' && rawVal.trim() !== '') {
      const ip = normalizeIp(rawVal.trim())
      return { ips: [ip], ip }
    }
  }

  const xClientIp = raw.headers['x-client-ip']
  if (xClientIp) {
    const rawVal = Array.isArray(xClientIp) ? xClientIp[0] : xClientIp
    if (typeof rawVal === 'string' && rawVal.trim() !== '') {
      const ip = normalizeIp(rawVal.trim())
      return { ips: [ip], ip }
    }
  }

  // 2. Parse standard X-Forwarded-For proxy chain
  const xForwardedFor = raw.headers['x-forwarded-for']
  let ips: string[] = []
  if (xForwardedFor) {
    const rawVal = Array.isArray(xForwardedFor)
      ? xForwardedFor.join(',')
      : xForwardedFor
    ips = rawVal.split(',').map((item) => normalizeIp(item.trim()))
  }

  let trustedIps = ips
  if (typeof trustProxy === 'number' && trustProxy > 0) {
    trustedIps = ips.slice(-(trustProxy + 1))
  }
  const ip = trustedIps.length > 0 ? trustedIps[0] : remoteAddress
  return { ips: trustedIps, ip }
}

export function resolveProtocol(
  raw: IncomingMessage,
  trustProxy: boolean | number
): string {
  const isTrusted =
    Boolean(trustProxy) ||
    process.env.TRUST_PROXY === 'true' ||
    process.env.EXIS_TRUST_PROXY === 'true'

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
  const isTrusted =
    Boolean(trustProxy) ||
    process.env.TRUST_PROXY === 'true' ||
    process.env.EXIS_TRUST_PROXY === 'true'

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
