import crypto from 'node:crypto'
import type { Handler } from '../types'
import type { ExisResponse } from '../server/response'
import type { ExisRequest } from '../server/request'
import { HttpError } from '../error/errors'
import { TtlCache } from '../utils/ttl-cache'

export interface IdempotencyRecord {
  statusCode: number
  headers: Record<string, string>
  body: any
  /** SHA-256 of the request body the response belongs to */
  fingerprint?: string
}

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null>
  set(key: string, data: IdempotencyRecord, ttlMs?: number): Promise<void>
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  // Capped so a flood of unique Idempotency-Key values cannot exhaust memory
  private cache = new TtlCache<IdempotencyRecord>(10000)

  async get(key: string) {
    return this.cache.get(key) ?? null
  }

  async set(key: string, data: IdempotencyRecord, ttlMs = 86400000) {
    this.cache.set(key, data, ttlMs)
  }
}

const defaultStore = new MemoryIdempotencyStore()

export interface IdempotentOptions {
  store?: IdempotencyStore
  headerName?: string
  /** Time-to-live in milliseconds for cached idempotent responses. Default: 86400000 (24h) */
  ttlMs?: number
  /**
   * Who a key belongs to. Keys are only shared between requests with the
   * same scope, so one client can never receive another client's response.
   * Default: `req.user.id` (or `sub`), and one shared scope for anonymous requests.
   */
  scope?: (req: ExisRequest<any, any, any>) => string | undefined
}

function defaultScope(req: ExisRequest<any, any, any>): string | undefined {
  const user: any = (req as any).user
  const id = user?.id ?? user?.sub ?? user?.userId
  return id === undefined || id === null ? undefined : String(id)
}

/**
 * Idempotency middleware (IETF `Idempotency-Key` draft).
 *
 * - A repeated request with the same key, user, method, path and body gets
 *   the first response again; the handler does not run twice.
 * - The same key with a **different body** is refused with `422`.
 * - A repeat that arrives while the first request is still running gets `409`.
 * - Only successful (2xx/3xx) responses are stored, so a failed request can be retried.
 */
export function idempotent(options: IdempotentOptions = {}): Handler {
  const store = options.store || defaultStore
  const headerName = (options.headerName || 'Idempotency-Key').toLowerCase()
  const ttlMs = options.ttlMs ?? 86400000 // 24 hours
  const scopeOf = options.scope || defaultScope
  // Requests in progress in this process
  const inFlight = new Set<string>()

  return async (
    req: ExisRequest<any, any, any>,
    res: ExisResponse,
    next: any
  ) => {
    const key = req.header(headerName)
    if (!key) return next()

    const cacheKey = [scopeOf(req) ?? '', req.method, req.path, key].join(
      '\u0000'
    )

    // Multipart bodies are streamed to the upload parser and cannot be read
    // twice, so they are matched on key alone
    const contentType = req.header('content-type') || ''
    const fingerprint = contentType.includes('multipart/form-data')
      ? undefined
      : crypto
          .createHash('sha256')
          .update(await req.text())
          .digest('base64url')

    const cached = await store.get(cacheKey)
    if (cached) {
      if (
        cached.fingerprint !== undefined &&
        fingerprint !== undefined &&
        cached.fingerprint !== fingerprint
      ) {
        return next(
          new HttpError(
            'Idempotency-Key was already used with a different request body',
            422,
            'IDEMPOTENCY_KEY_REUSED'
          )
        )
      }
      res.status(cached.statusCode)
      for (const [k, v] of Object.entries(cached.headers)) {
        res.setHeader(k, v)
      }
      res.setHeader('Idempotent-Replayed', 'true')
      if (typeof cached.body === 'string' || Buffer.isBuffer(cached.body)) {
        return res.send(cached.body)
      }
      return res.json(cached.body)
    }

    if (inFlight.has(cacheKey)) {
      return next(
        new HttpError(
          'A request with this Idempotency-Key is still being processed',
          409,
          'IDEMPOTENCY_IN_PROGRESS'
        )
      )
    }
    inFlight.add(cacheKey)
    const release = () => inFlight.delete(cacheKey)
    res.raw.once('close', release)
    res.raw.once('finish', release)

    const save = (body: any) => {
      if (res.statusCode < 200 || res.statusCode >= 400) return
      const contentTypeOut = res.getHeader('Content-Type')
      store
        .set(
          cacheKey,
          {
            statusCode: res.statusCode,
            headers: contentTypeOut
              ? { 'content-type': String(contentTypeOut) }
              : {},
            body,
            fingerprint,
          },
          ttlMs
        )
        .catch((err) =>
          req.log?.error?.(
            { err },
            '[exis] Failed to store idempotent response'
          )
        )
    }

    const originalJson = res.json.bind(res)
    const originalSend = res.send.bind(res)
    res.json = (body: any) => {
      originalJson(body)
      save(body)
    }
    res.send = (body: any) => {
      originalSend(body)
      // send() hands objects to json(), which already saved them
      if (typeof body === 'string' || Buffer.isBuffer(body)) save(body)
    }

    next()
  }
}

/** @deprecated Use `idempotent` (camelCase) instead */
export const Idempotent = idempotent
