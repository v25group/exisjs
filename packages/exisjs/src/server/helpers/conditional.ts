// Conditional requests (RFC 9110 §13): entity tags, Last-Modified, and the
// order in which If-Match, If-Unmodified-Since, If-None-Match and
// If-Modified-Since are evaluated. Shared by automatic ETags, static files,
// downloads and res.checkPreconditions().
import crypto from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

/** What the server knows about the current representation. */
export interface Validators {
  /** Entity tag, quoted or not: `"v3"`, `W/"v3"` or `v3` */
  etag?: string
  /** When the representation last changed */
  lastModified?: Date | number | string
  /** `false` when the target resource does not exist (for `If-Match: *` / `If-None-Match: *`) */
  exists?: boolean
}

/**
 * `ok`: send the normal response. `not-modified`: answer 304 (GET/HEAD).
 * `failed`: answer 412 Precondition Failed.
 */
export type PreconditionOutcome = 'ok' | 'not-modified' | 'failed'

// Node 20.12+ has a one-shot hash that skips the Hash object (about 35%
// faster for typical response sizes) and hashes strings without a copy
const oneShotHash:
  ((alg: string, data: string | Buffer, enc: 'base64') => string) | undefined =
  typeof (crypto as any).hash === 'function' ? (crypto as any).hash : undefined

/**
 * Weak ETag for a response body: byte length in hex plus a truncated
 * base64 SHA-1, the format of the `etag` package. SHA-1 only detects changes
 * here; it is not a security boundary.
 */
export function generateETag(
  body: string | Buffer,
  byteLength?: number
): string {
  const length =
    byteLength ??
    (typeof body === 'string' ? Buffer.byteLength(body) : body.length)
  if (length === 0) return 'W/"0-2jmj7l5rsw0yVb/vlWAYkK/YBwk"'
  const hash = oneShotHash
    ? oneShotHash('sha1', body, 'base64')
    : crypto.createHash('sha1').update(body).digest('base64')
  return `W/"${length.toString(16)}-${hash.slice(0, 27)}"`
}

/** Weak ETag for a file from its size and modification time (as `send` / `serve-static` do). */
export function fileETag(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`
}

/**
 * Quotes a bare tag (`v3` → `"v3"`) and checks it is a valid entity tag, so a
 * handler-supplied value can never break the header.
 */
export function formatETag(tag: string): string {
  const quoted = tag.startsWith('"') || tag.startsWith('W/"') ? tag : `"${tag}"`
  if (!/^(W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(quoted)) {
    throw new TypeError(
      `Invalid ETag ${JSON.stringify(tag)}: use visible ASCII characters other than '"'`
    )
  }
  return quoted
}

/** Milliseconds rounded down to whole seconds, the precision of HTTP dates. */
export function toHttpTime(value: Date | number | string): number | undefined {
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'number'
        ? value
        : Date.parse(value)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) * 1000 : undefined
}

// The opaque part of a tag, without the W/ prefix
function opaque(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag
}

/**
 * Whether a list header (`If-Match` / `If-None-Match`) matches `etag`.
 * Strong comparison (If-Match) requires both tags to be strong; weak
 * comparison (If-None-Match) ignores the W/ prefix. Entity tags may contain
 * commas, so the list is scanned for quoted strings rather than split.
 */
export function matchesETagList(
  header: string,
  etag: string | undefined,
  exists: boolean,
  strong: boolean
): boolean {
  if (header.trim() === '*') return exists
  if (etag === undefined) return false
  if (strong && etag.startsWith('W/')) return false
  const target = opaque(etag)
  let i = 0
  const n = header.length
  while (i < n) {
    const c = header.charCodeAt(i)
    if (c === 32 || c === 9 || c === 44 /* space, tab, comma */) {
      i++
      continue
    }
    let weak = false
    if (c === 87 /* W */ && header.charCodeAt(i + 1) === 47 /* / */) {
      weak = true
      i += 2
    }
    if (header.charCodeAt(i) !== 34 /* " */) {
      // Not an entity tag: skip to the next list element
      const next = header.indexOf(',', i)
      if (next === -1) return false
      i = next + 1
      continue
    }
    const end = header.indexOf('"', i + 1)
    if (end === -1) return false
    if (
      !(strong && weak) &&
      end + 1 - i === target.length &&
      header.startsWith(target, i)
    ) {
      return true
    }
    i = end + 1
  }
  return false
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value
}

/**
 * Evaluates the request's preconditions against the current validators, in
 * the order RFC 9110 §13.2.2 prescribes:
 *
 * 1. If-Match (strong comparison), else If-Unmodified-Since: `failed` when not met
 * 2. If-None-Match (weak comparison): `not-modified` for GET/HEAD, else `failed`
 * 3. Otherwise, for GET/HEAD, If-Modified-Since: `not-modified` when unchanged
 *
 * Unparsable dates are ignored, as the RFC requires.
 */
export function evaluatePreconditions(
  method: string,
  headers: IncomingHttpHeaders,
  current: { etag?: string; lastModified?: number; exists?: boolean }
): PreconditionOutcome {
  const exists = current.exists !== false
  const isRead = method === 'GET' || method === 'HEAD'

  const ifMatch = headerValue(headers['if-match'])
  if (ifMatch !== undefined) {
    if (!matchesETagList(ifMatch, current.etag, exists, true)) return 'failed'
  } else {
    const ifUnmodifiedSince = headerValue(headers['if-unmodified-since'])
    if (ifUnmodifiedSince !== undefined && current.lastModified !== undefined) {
      const since = toHttpTime(ifUnmodifiedSince)
      if (since !== undefined && current.lastModified > since) return 'failed'
    }
  }

  const ifNoneMatch = headerValue(headers['if-none-match'])
  if (ifNoneMatch !== undefined) {
    if (matchesETagList(ifNoneMatch, current.etag, exists, false)) {
      return isRead ? 'not-modified' : 'failed'
    }
    return 'ok'
  }

  if (isRead && exists && current.lastModified !== undefined) {
    const ifModifiedSince = headerValue(headers['if-modified-since'])
    if (ifModifiedSince !== undefined) {
      const since = toHttpTime(ifModifiedSince)
      if (since !== undefined && current.lastModified <= since)
        return 'not-modified'
    }
  }
  return 'ok'
}

/** True when the request carries any precondition header (the cheap pre-check). */
export function hasPreconditions(headers: IncomingHttpHeaders): boolean {
  return (
    headers['if-none-match'] !== undefined ||
    headers['if-modified-since'] !== undefined ||
    headers['if-match'] !== undefined ||
    headers['if-unmodified-since'] !== undefined
  )
}

/**
 * Whether `encoding` is acceptable per an Accept-Encoding header, honouring
 * `q=0` (an explicit refusal) and `*`.
 */
export function acceptsEncoding(
  header: string | undefined,
  encoding: string
): boolean {
  if (!header) return false
  let wildcard = false
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().split(';')
    const token = name.trim().toLowerCase()
    let q = 1
    for (const p of params) {
      const [k, v] = p.trim().split('=')
      if (k.trim().toLowerCase() === 'q') q = Number(v)
    }
    if (token === encoding) return q > 0
    if (token === '*') wildcard = q > 0
  }
  return wildcard
}
