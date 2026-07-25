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

  if (options.contentSecurityPolicy) {
    staticHeaders['Content-Security-Policy'] = options.contentSecurityPolicy
  }

  const hidePoweredBy = options.hidePoweredBy !== false
  const headerEntries = Object.entries(staticHeaders)

  return (req: Request, res: Response, next: NextFunction) => {
    for (const [key, value] of headerEntries) {
      res.set(key, value)
    }
    if (hidePoweredBy) {
      res.removeHeader('X-Powered-By')
    }
    next()
  }
}

// ─── CSRF Protection ──────────────────────────────────────────────────────────

export interface CsrfOptions {
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

/**
 * CSRF middleware using Double Submit Cookie pattern.
 * Generates a random token on GET requests and sets it as a cookie.
 * Requires the client to send the same token in a header on state-changing requests.
 */
export function csrf(options: CsrfOptions = {}): Handler {
  const cookieName = options.cookieName || 'csrf-token'
  const headerName = (options.headerName || 'x-csrf-token').toLowerCase()

  const generateToken = () => crypto.randomUUID()

  return (req: Request, res: Response, next: NextFunction) => {
    // Read existing token from cookie
    let token = req.cookies[cookieName]

    // If no token exists, generate one
    if (!token) {
      token = generateToken()
      res.cookie(cookieName, token, {
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

    // For state-changing methods, validate the header token matches the cookie
    const headerToken = req.get(headerName)
    if (!headerToken || headerToken !== token) {
      return next(new HttpError('Invalid CSRF token', 403, 'CSRF_FAILED'))
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

// ─── XSS Sanitization ─────────────────────────────────────────────────────────

function sanitizeHtml(str: string): string {
  if (typeof str !== 'string') return str
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function traverseAndSanitizeXss(obj: unknown): unknown {
  if (typeof obj === 'string') return sanitizeHtml(obj)
  if (Array.isArray(obj)) return obj.map(traverseAndSanitizeXss)
  if (obj && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      sanitized[k] = traverseAndSanitizeXss(v)
    }
    return sanitized
  }
  return obj
}

export function xss(): Handler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.body) req.body = traverseAndSanitizeXss(req.body)
    if (Object.keys(req.query).length > 0)
      req.query = traverseAndSanitizeXss(req.query) as Record<string, string>
    if (Object.keys(req.params).length > 0)
      req.params = traverseAndSanitizeXss(req.params) as Record<string, string>
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

// ─── SQL Injection Protection ─────────────────────────────────────────────────

const SQL_INJECTION_REGEX = /(?:\b(?:UNION|SELECT|INSERT|UPDATE|DELETE|DROP|EXEC|ALTER|TRUNCATE)\b)|(?:--|;)/i

function sanitizeSql(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(new RegExp(SQL_INJECTION_REGEX, 'gi'), '[FILTERED]')
  }
  if (Array.isArray(obj)) return obj.map(sanitizeSql)
  if (obj && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      sanitized[k] = sanitizeSql(v)
    }
    return sanitized
  }
  return obj
}

export function sqlSanitize(): Handler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.body) req.body = sanitizeSql(req.body)
    if (Object.keys(req.query).length > 0)
      req.query = sanitizeSql(req.query) as Record<string, string>
    if (Object.keys(req.params).length > 0)
      req.params = sanitizeSql(req.params) as Record<string, string>
    next()
  }
}

// ─── Universal Database Sanitizer ──────────────────────────────────────────────

export interface DbSanitizeOptions {
  mongo?: boolean
  sql?: boolean
}

export function dbSanitize(options: DbSanitizeOptions = { mongo: true, sql: false }): Handler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (options.mongo) {
      if (req.body) req.body = sanitizeMongo(req.body)
      if (Object.keys(req.query).length > 0) req.query = sanitizeMongo(req.query) as Record<string, string>
      if (Object.keys(req.params).length > 0) req.params = sanitizeMongo(req.params) as Record<string, string>
    }
    
    if (options.sql) {
      if (req.body) req.body = sanitizeSql(req.body)
      if (Object.keys(req.query).length > 0) req.query = sanitizeSql(req.query) as Record<string, string>
      if (Object.keys(req.params).length > 0) req.params = sanitizeSql(req.params) as Record<string, string>
    }
    
    next()
  }
}
