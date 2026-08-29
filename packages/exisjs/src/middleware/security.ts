import crypto from 'node:crypto'
import type { Handler, Request, Response, NextFunction } from '../types'
import { HttpError } from '../utils/errors'

// ─── Security Headers (Helmet) ────────────────────────────────────────────────

export interface HelmetOptions {
  contentSecurityPolicy?: string
  hsts?: boolean | { maxAge: number; includeSubDomains: boolean }
  noSniff?: boolean
  xssFilter?: boolean
  hidePoweredBy?: boolean
  frameguard?: boolean | { action: 'DENY' | 'SAMEORIGIN' }
}

/**
 * Helmet-style middleware for setting strict security headers.
 */
export function helmet(options: HelmetOptions = {}): Handler {
  const staticHeaders: Record<string, string> = {
    'X-DNS-Prefetch-Control': 'off',
    'X-Download-Options': 'noopen',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  }

  if (options.hsts !== false) {
    const hstsOpt =
      typeof options.hsts === 'object'
        ? options.hsts
        : { maxAge: 31536000, includeSubDomains: true }
    let header = `max-age=${hstsOpt.maxAge}`
    if (hstsOpt.includeSubDomains) header += '; includeSubDomains'
    staticHeaders['Strict-Transport-Security'] = header
  }

  if (options.noSniff !== false) {
    staticHeaders['X-Content-Type-Options'] = 'nosniff'
  }

  if (options.xssFilter !== false) {
    staticHeaders['X-XSS-Protection'] = '1; mode=block'
  }

  if (options.frameguard !== false) {
    const action =
      typeof options.frameguard === 'object'
        ? options.frameguard.action
        : 'DENY'
    staticHeaders['X-Frame-Options'] = action
  }

  if (
    options.contentSecurityPolicy &&
    !options.contentSecurityPolicy.includes('{nonce}')
  ) {
    staticHeaders['Content-Security-Policy'] = options.contentSecurityPolicy
  }

  const hidePoweredBy = options.hidePoweredBy !== false
  const headerKeys = Object.keys(staticHeaders)
  const headerValues = Object.values(staticHeaders)
  const headerCount = headerKeys.length

  return (req: Request, res: Response, next: NextFunction) => {
    // Generate CSP nonce if needed
    if (
      options.contentSecurityPolicy &&
      options.contentSecurityPolicy.includes('{nonce}')
    ) {
      const nonce = crypto.randomBytes(16).toString('base64url')
      ;(req as any).cspNonce = nonce
      res.setHeader(
        'Content-Security-Policy',
        options.contentSecurityPolicy.replace(/\{nonce\}/g, nonce)
      )
    }

    if (hidePoweredBy) {
      res.removeHeader('X-Powered-By')
    }

    // Indexed loop — avoids allocating an iterator object on every request
    for (let i = 0; i < headerCount; i++) {
      res.setHeader(headerKeys[i], headerValues[i])
    }
    next()
  }
}

// ─── CSRF Protection ──────────────────────────────────────────────────────────

export interface CsrfOptions {
  secret: string
  cookieName?: string
  headerName?: string
  cookieOptions?: {
    httpOnly?: boolean
    secure?: boolean
    sameSite?: 'Strict' | 'Lax' | 'None'
    path?: string
    maxAge?: number
  }
}

function signCsrfToken(val: string, secret: string): string {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(val)
    .digest('base64url')
  return `${val}.${signature}`
}

function unsignCsrfToken(val: string, secret: string): string | false {
  const parts = val.split('.')
  if (parts.length !== 2) return false
  const [str, signature] = parts
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(str)
    .digest('base64url')

  const sigBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expectedSignature)

  if (sigBuf.length !== expectedBuf.length) return false
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false
  return str
}

/**
 * CSRF middleware using Signed Double Submit Cookie pattern.
 * Generates a random token on GET requests and sets it as a signed cookie.
 * Requires the client to send the same unsigned token in a header on state-changing requests.
 */
export function csrf(options: CsrfOptions): Handler {
  if (!options.secret || options.secret.length < 32) {
    throw new Error('CSRF options.secret must be at least 32 characters long')
  }

  const cookieName = options.cookieName || 'csrf-token'
  const headerName = (options.headerName || 'x-csrf-token').toLowerCase()

  const generateToken = () => crypto.randomUUID()

  return (req: Request, res: Response, next: NextFunction) => {
    const rawCookie = req.cookies[cookieName]
    let token: string | false = false

    if (rawCookie) {
      token = unsignCsrfToken(rawCookie, options.secret)
    }

    // If no valid token exists in the signed cookie, generate a new one
    if (!token) {
      token = generateToken()
      res.cookie(cookieName, signCsrfToken(token, options.secret), {
        httpOnly: options.cookieOptions?.httpOnly ?? false, // Must be readable by client JS to send in header
        secure:
          options.cookieOptions?.secure ??
          process.env.NODE_ENV === 'production',
        sameSite: options.cookieOptions?.sameSite ?? 'Lax',
        path: options.cookieOptions?.path ?? '/',
        maxAge: options.cookieOptions?.maxAge ?? 86400,
      })
    }

    // Pass token to request object for templates if needed
    ;(req as Request & { csrfToken?: string }).csrfToken = token

    // Safe methods don't need CSRF validation
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next()
    }

    // For state-changing methods, validate the header token matches the unsigned cookie token
    const headerToken = req.get(headerName)
    if (!headerToken || headerToken !== token) {
      return next(new HttpError('Invalid CSRF token', 403, 'CSRF_FAILED'))
    }

    // Additional security layer: Verify Origin or Referer matches the Host
    const origin = req.get('origin')
    const referer = req.get('referer')
    const host = req.get('host')

    if (origin || referer) {
      const source = origin || referer || ''
      try {
        const sourceHost = new URL(source).host
        if (sourceHost !== host) {
          return next(new HttpError('CSRF Origin mismatch', 403, 'CSRF_FAILED'))
        }
      } catch {
        return next(
          new HttpError('Invalid Origin/Referer format', 403, 'CSRF_FAILED')
        )
      }
    }

    next()
  }
}

// ─── Request Timeout ──────────────────────────────────────────────────────────

export interface TimeoutOptions {
  ms: number
  message?: string
}

/**
 * Times out the request if the response hasn't been sent within the specified ms.
 */
export function timeout(ms: number | TimeoutOptions): Handler {
  const options = typeof ms === 'number' ? { ms } : ms

  return (req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: {
            code: 'TIMEOUT',
            message: options.message || 'Request timeout',
          },
        })
      }
    }, options.ms)

    res.raw.on('finish', () => clearTimeout(timer))
    res.raw.on('close', () => clearTimeout(timer))

    next()
  }
}

// ─── HTTP Parameter Pollution (HPP) ───────────────────────────────────────────

export function hpp(): Handler {
  return (req: Request, res: Response, next: NextFunction) => {
    // If a query parameter is an array (multiple values), take only the last one
    for (const [key, val] of Object.entries(req.query)) {
      if (Array.isArray(val)) {
        req.query[key] = val[val.length - 1]
      }
    }

    // Do the same for body if it's form-urlencoded array
    if (req.body && typeof req.body === 'object') {
      for (const [key, val] of Object.entries(
        req.body as Record<string, unknown>
      )) {
        if (Array.isArray(val)) {
          ;(req.body as Record<string, unknown>)[key] = val[val.length - 1]
        }
      }
    }
    next()
  }
}

// ─── NoSQL Injection Protection ───────────────────────────────────────────────

function sanitizeMongo(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sanitizeMongo)
  if (obj && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('$') || k.includes('.')) {
        continue // Strip dangerous keys
      }
      sanitized[k] = sanitizeMongo(v)
    }
    return sanitized
  }
  return obj
}

export function mongoSanitize(): Handler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.body) req.body = sanitizeMongo(req.body)
    if (Object.keys(req.query).length > 0)
      req.query = sanitizeMongo(req.query) as Record<string, string>
    if (Object.keys(req.params).length > 0)
      req.params = sanitizeMongo(req.params) as Record<string, string>
    next()
  }
}

// ─── Universal Database Sanitizer ──────────────────────────────────────────────

export interface DbSanitizeOptions {
  mongo?: boolean
}

export function dbSanitize(
  options: DbSanitizeOptions = { mongo: true }
): Handler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (options.mongo) {
      if (req.body) req.body = sanitizeMongo(req.body)
      if (Object.keys(req.query).length > 0)
        req.query = sanitizeMongo(req.query) as Record<string, string>
      if (Object.keys(req.params).length > 0)
        req.params = sanitizeMongo(req.params) as Record<string, string>
    }

    next()
  }
}
