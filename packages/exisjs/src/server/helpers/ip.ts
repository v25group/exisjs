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
  const xForwardedFor = raw.headers['x-forwarded-for']
  let ips: string[] = []
  if (xForwardedFor) {
    const rawVal = Array.isArray(xForwardedFor)
      ? xForwardedFor.join(',')
      : xForwardedFor
    ips = rawVal.split(',').map((item) => normalizeIp(item.trim()))
  }

  const rawRemote = raw.socket?.remoteAddress ?? '127.0.0.1'
  const remoteAddress = normalizeIp(rawRemote)

  if (trustProxy) {
    let trustedIps = ips
    if (typeof trustProxy === 'number' && trustProxy > 0) {
      trustedIps = ips.slice(-(trustProxy + 1))
    }
    const ip = trustedIps.length > 0 ? trustedIps[0] : remoteAddress
    return { ips: trustedIps, ip }
  }

  return { ips: [], ip: remoteAddress }
}

export function resolveProtocol(
  raw: IncomingMessage,
  trustProxy: boolean | number
): string {
  const connection = raw.socket as import('node:net').Socket & {
    encrypted?: boolean
  }
  const isTls = connection?.encrypted || false
  let protocol = isTls ? 'https' : 'http'

  const xForwardedProto = raw.headers['x-forwarded-proto']
  if (trustProxy && xForwardedProto) {
    const rawProto = Array.isArray(xForwardedProto)
      ? xForwardedProto.join(',')
      : xForwardedProto
    protocol = rawProto.split(',')[0].trim()
  }
  return protocol
}

export function resolveHostname(
  raw: IncomingMessage,
  trustProxy: boolean | number
): string {
  let host = raw.headers['x-forwarded-host']
  if (!host || !trustProxy) {
    host = raw.headers.host || ''
  }
  if (Array.isArray(host)) host = host[0]

  // IPv6 can have colons, so look for port after bracket or last colon
  const offset = host[0] === '[' ? host.indexOf(']') + 1 : 0
  const index = host.indexOf(':', offset)
  return index !== -1 ? host.substring(0, index) : host
}
