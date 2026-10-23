import type { IncomingMessage } from 'node:http'
import { BlockList, isIPv6 } from 'node:net'

/**
 * - `false`: socket address only.
 * - `true`: every hop is a proxy that overwrites forwarding headers.
 * - `N`: the N closest hops are proxies.
 * - `'cloudflare'`: `CF-Connecting-IP`, only from a Cloudflare address.
 * - `{ header }`: one named header set by your own proxy, e.g. `x-real-ip`.
 */
export type TrustProxy = boolean | number | 'cloudflare' | { header: string }

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

export function isProxyTrusted(trustProxy: TrustProxy): boolean {
  return Boolean(trustProxy) || envTrustsProxy()
}

function firstHeader(val: string | string[] | undefined): string | undefined {
  const v = Array.isArray(val) ? val[0] : val
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t === '' ? undefined : t
}

// Cloudflare's published ranges (https://www.cloudflare.com/ips/), checked
// 2026-10-22. shortcut: fixed list, fetch it at start if Cloudflare changes it often
const CLOUDFLARE_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
]
// A proxy on the same machine or network (Traefik, nginx, a load balancer)
const PRIVATE_RANGES = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '100.64.0.0/10',
  'fc00::/7',
  '::1/128',
]

function blockListOf(ranges: string[]): BlockList {
  const list = new BlockList()
  for (const range of ranges) {
    const [net, bits] = range.split('/')
    list.addSubnet(net, Number(bits), isIPv6(net) ? 'ipv6' : 'ipv4')
  }
  return list
}

let cloudflare: BlockList | undefined
let privateNets: BlockList | undefined
function inList(list: BlockList, ip: string): boolean {
  try {
    return list.check(ip, isIPv6(ip) ? 'ipv6' : 'ipv4')
  } catch {
    return false // not an IP address
  }
}

/**
 * True when the request reached us from Cloudflare: directly, or through a
 * local proxy (a private socket peer) whose last X-Forwarded-For hop is
 * Cloudflare. A client connecting directly can't pass, whatever it sends.
 */
function fromCloudflare(
  peer: string,
  xForwardedFor: string | string[] | undefined
): boolean {
  cloudflare ??= blockListOf(CLOUDFLARE_RANGES)
  if (inList(cloudflare, peer)) return true
  privateNets ??= blockListOf(PRIVATE_RANGES)
  if (!xForwardedFor || !inList(privateNets, peer)) return false
  const hops = (
    Array.isArray(xForwardedFor) ? xForwardedFor.join(',') : xForwardedFor
  ).split(',')
  return inList(cloudflare, normalizeIp(hops[hops.length - 1].trim()))
}

/**
 * Resolves the client IP.
 *
 * - `trustProxy: false` -> socket address only.
 * - `trustProxy: true`  -> trust every hop: CF-Connecting-IP, else the
 *   left-most X-Forwarded-For entry. Only safe when every request passes
 *   through a proxy that overwrites these headers.
 * - `trustProxy: N`     -> trust the N closest hops, counting the socket peer
 *   (Express semantics). The client is the entry N steps back from the
 *   socket, so values a client prepends to X-Forwarded-For are ignored.
 *   CDN headers are not consulted, since any client can send them.
 * - `trustProxy: 'cloudflare'` -> CF-Connecting-IP, only when the request
 *   came from a Cloudflare address; otherwise the socket address.
 * - `trustProxy: { header }` -> that header, else the socket address.
 */
export function resolveIps(
  raw: IncomingMessage,
  trustProxy: TrustProxy
): { ips: string[]; ip: string } {
  const rawRemote = raw.socket?.remoteAddress ?? '127.0.0.1'
  const remoteAddress = normalizeIp(rawRemote)

  if (!isProxyTrusted(trustProxy)) {
    return { ips: [], ip: remoteAddress }
  }

  if (trustProxy === 'cloudflare' || typeof trustProxy === 'object') {
    let value: string | undefined
    if (trustProxy === 'cloudflare') {
      if (fromCloudflare(remoteAddress, raw.headers['x-forwarded-for'])) {
        value = firstHeader(raw.headers['cf-connecting-ip'])
      }
    } else {
      value = firstHeader(raw.headers[trustProxy.header.toLowerCase()])
    }
    if (!value) return { ips: [], ip: remoteAddress }
    const ip = normalizeIp(value)
    return { ips: [ip], ip }
  }

  const hops =
    typeof trustProxy === 'number' && trustProxy > 0 ? trustProxy : Infinity

  if (hops === Infinity) {
    // True-Client-IP, X-Real-IP and X-Client-IP are not read: any client can
    // send them, and only { header } says your proxy sets one
    const direct = firstHeader(raw.headers['cf-connecting-ip'])
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
  trustProxy: TrustProxy
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

/** The host the client asked for, with its port: X-Forwarded-Host behind a trusted proxy. */
export function resolveHost(
  raw: IncomingMessage,
  trustProxy: TrustProxy
): string {
  const forwarded = isProxyTrusted(trustProxy)
    ? firstHeader(raw.headers['x-forwarded-host'])
    : undefined
  // A chain of proxies can list several hosts; the first is the client's
  return forwarded ? forwarded.split(',')[0].trim() : raw.headers.host || ''
}

export function resolveHostname(
  raw: IncomingMessage,
  trustProxy: TrustProxy
): string {
  const host = resolveHost(raw, trustProxy)

  // IPv6 can have colons, so look for port after bracket or last colon
  const offset = host[0] === '[' ? host.indexOf(']') + 1 : 0
  const index = host.indexOf(':', offset)
  return index !== -1 ? host.substring(0, index) : host
}
