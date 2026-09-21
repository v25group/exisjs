import crypto from 'node:crypto'
import type { Handler, Request, Response, NextFunction } from '../types'
import { HttpError } from '../error/errors'

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
  ms?: number
  message?: string
  statusCode?: number
  exclude?: (string | RegExp)[] | ((req: Request) => boolean)
}

/**
 * Times out the request if the response hasn't been sent within the specified ms.
 * Defaults to 60,000ms (60 seconds) to accommodate cloud storage, AI/LLM streaming,
 * and heavy asset uploads.
 */
export function timeout(msOrOptions?: number | TimeoutOptions): Handler {
  const options: TimeoutOptions =
    typeof msOrOptions === 'number'
      ? { ms: msOrOptions }
      : { ms: 60000, ...msOrOptions }

  const defaultMs = options.ms ?? 60000
  const statusCode = options.statusCode ?? 503
  const message = options.message || 'Request timeout'

  return (req: Request, res: Response, next: NextFunction) => {
    // Check exclusions
    if (options.exclude) {
      if (typeof options.exclude === 'function' && options.exclude(req)) {
        return next()
      }
      if (Array.isArray(options.exclude)) {
        const path = req.path || req.url || '/'
        const isExcluded = options.exclude.some((pattern) =>
          typeof pattern === 'string'
            ? path.startsWith(pattern)
            : pattern.test(path)
        )
        if (isExcluded) return next()
      }
    }

    let timer: NodeJS.Timeout | null = null

    const setTimer = (currentMs: number) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (!res.headersSent) {
          res.status(statusCode).json({
            success: false,
            error: {
              code: 'TIMEOUT',
              message,
            },
          })
        }
      }, currentMs)
      if (typeof timer.unref === 'function') {
        timer.unref()
      }
    }

    // Attach dynamic timeout adjustment to req
    const setTimeoutFn = (newMs: number) => {
      if (newMs <= 0) {
        if (timer) clearTimeout(timer)
        timer = null
      } else {
        setTimer(newMs)
      }
      return req
    }
    const clearTimeoutFn = () => {
      if (timer) clearTimeout(timer)
      timer = null
      return req
    }

    ;(req as any).setTimeout = setTimeoutFn
    ;(req as any).clearTimeout = clearTimeoutFn
    ;(req as any)._timeoutSetter = setTimeoutFn
    ;(req as any)._timeoutClearer = clearTimeoutFn

    setTimer(defaultMs)

    res.raw.on('finish', () => {
      if (timer) clearTimeout(timer)
    })
    res.raw.on('close', () => {
      if (timer) clearTimeout(timer)
    })

    next()
  }
}

/**
 * Route-level timeout override middleware.
 * If a global timeout is already active on req, seamlessly updates the timer to the route's custom duration.
 * If no global timeout is installed, mounts an isolated timeout lifecycle for this endpoint.
 */
export function routeTimeout(msOrOptions: number | TimeoutOptions): Handler {
  const options: TimeoutOptions =
    typeof msOrOptions === 'number'
      ? { ms: msOrOptions }
      : { ms: 60000, ...msOrOptions }
  const ms = options.ms ?? 60000

  return (req: any, res: any, next: any) => {
    if (typeof req._timeoutSetter === 'function') {
      if (ms <= 0) {
        req.clearTimeout?.()
      } else {
        req.setTimeout(ms)
      }
      next()
    } else {
      timeout(options)(req, res, next)
    }
  }
}

// ─── HTTP Parameter Pollution (HPP) ───────────────────────────────────────────

export function hpp(): Handler {
  return async (req: Request, res: Response, next: NextFunction) => {
    // If a query parameter is an array (multiple values), take only the last one
    if (req.query && typeof req.query === 'object') {
      for (const [key, val] of Object.entries(req.query)) {
        if (Array.isArray(val)) {
          req.query[key] = val[val.length - 1]
        }
      }
    }

    // Automatically synchronize body if incoming request has body but hasn't been parsed
    if (
      req.body === undefined &&
      ['POST', 'PUT', 'PATCH'].includes(req.method) &&
      typeof (req as any).json === 'function'
    ) {
      try {
        await (req as any).json()
      } catch {
        /* let subsequent validation catch invalid JSON */
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
  return async (req: Request, res: Response, next: NextFunction) => {
    if (
      req.body === undefined &&
      ['POST', 'PUT', 'PATCH'].includes(req.method) &&
      typeof (req as any).json === 'function'
    ) {
      try {
        await (req as any).json()
      } catch {
        /* ignore */
      }
    }

    if (req.body) req.body = sanitizeMongo(req.body)
    if (
      req.query &&
      typeof req.query === 'object' &&
      Object.keys(req.query).length > 0
    ) {
      req.query = sanitizeMongo(req.query) as Record<string, string>
    }
    if (
      req.params &&
      typeof req.params === 'object' &&
      Object.keys(req.params).length > 0
    ) {
      req.params = sanitizeMongo(req.params) as Record<string, string>
    }
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
  return async (req: Request, res: Response, next: NextFunction) => {
    if (options.mongo) {
      if (
        req.body === undefined &&
        ['POST', 'PUT', 'PATCH'].includes(req.method) &&
        typeof (req as any).json === 'function'
      ) {
        try {
          await (req as any).json()
        } catch {
          /* ignore */
        }
      }

      if (req.body) req.body = sanitizeMongo(req.body)
      if (
        req.query &&
        typeof req.query === 'object' &&
        Object.keys(req.query).length > 0
      ) {
        req.query = sanitizeMongo(req.query) as Record<string, string>
      }
      if (
        req.params &&
        typeof req.params === 'object' &&
        Object.keys(req.params).length > 0
      ) {
        req.params = sanitizeMongo(req.params) as Record<string, string>
      }
    }

    next()
  }
}

// ─── Security Scanner Noise Suppression & Blackhole Handler ────────────────────

export interface BlockProbesOptions {
  /**
   * HTTP status code to return for blocked exploit probes.
   * Defaults to 404 (or 403 if specified).
   */
  statusCode?: number
  /**
   * Whether to terminate the connection immediately with an empty body (blackhole).
   * Defaults to true.
   */
  blackhole?: boolean
  /**
   * Optional custom response message (if blackhole is false or a string response is desired).
   */
  message?: string
  /**
   * Whether to suppress warning and error logs in requestLogger for probe requests.
   * Defaults to true.
   */
  silent?: boolean
  /**
   * Custom additional probe regex patterns or strings to block.
   */
  patterns?: (string | RegExp)[]
  /**
   * Custom whitelist patterns to exclude from being blocked.
   */
  exclude?: (string | RegExp)[]
  /**
   * Optional callback triggered when a probe is detected.
   * Useful for honeypot telemetry, custom SIEM alerting, or IP reputation systems.
   */
  onProbe?: (
    req: Request,
    res: Response,
    matchedPattern: string | RegExp
  ) => void
}

export const DEFAULT_PROBE_PATTERNS: RegExp[] = [
  // Environment and secrets
  /(?:^|\/)\.env(?:\..*)?$/i,
  /(?:^|\/)\.env(?:$|[.\-_/])/i,
  /(?:^|\/)\.(?:aws|ssh|docker|kube|npmrc|dockercfg)(?:$|\/)/i,
  // Version control
  /(?:^|\/)\.git(?:$|\/)/i,
  /(?:^|\/)\.svn(?:$|\/)/i,
  /(?:^|\/)\.hg(?:$|\/)/i,
  /(?:^|\/)\.bzr(?:$|\/)/i,
  // OS artifacts
  /(?:^|\/)\.DS_Store$/i,
  /(?:^|\/)Thumbs\.db$/i,
  // Common scanner/CMS targets on Node servers
  /(?:^|\/)(?:wp-config\.php|wp-login\.php|wp-admin|xmlrpc\.php)(?:$|\/)/i,
  /(?:^|\/)(?:phpinfo\.php|info\.php|eval-stdin\.php)(?:$|\/)/i,
  /(?:^|\/)actuator\/(?:heapdump|env)/i,
]

function decodePathSafely(rawPath: string): string {
  try {
    return decodeURIComponent(rawPath)
  } catch {
    return rawPath
  }
}

/**
 * Intercepts automated vulnerability scanner probes (e.g. `.env`, `/.git`, `/.DS_Store`)
 * and blackholes/terminates them immediately without running downstream handlers or
 * flooding production error logs with 404 warnings.
 */
export function blockSuspiciousProbes(
  options: BlockProbesOptions = {}
): Handler {
  const statusCode = options.statusCode ?? 404
  const blackhole = options.blackhole !== false
  const silent = options.silent !== false
  const customPatterns: (string | RegExp)[] = options.patterns || []
  const excludePatterns: (string | RegExp)[] = options.exclude || []
  const onProbe = options.onProbe

  // Precompile patterns to avoid runtime regex parsing overhead
  const compiledPatterns: (RegExp | string)[] = [
    ...DEFAULT_PROBE_PATTERNS,
    ...customPatterns,
  ]

  return (req: Request, res: Response, next: NextFunction) => {
    const rawPath = req.path || req.url || '/'
    const decodedPath = decodePathSafely(rawPath)

    // Check whitelist/exclusions
    if (excludePatterns.length > 0) {
      const isExcluded = excludePatterns.some((pattern) => {
        if (typeof pattern === 'string') {
          return rawPath.startsWith(pattern) || decodedPath.startsWith(pattern)
        }
        return pattern.test(rawPath) || pattern.test(decodedPath)
      })
      if (isExcluded) {
        return next()
      }
    }

    // Check probe patterns
    let matchedPattern: string | RegExp | null = null
    for (const pattern of compiledPatterns) {
      if (typeof pattern === 'string') {
        if (rawPath.includes(pattern) || decodedPath.includes(pattern)) {
          matchedPattern = pattern
          break
        }
      } else if (pattern.test(rawPath) || pattern.test(decodedPath)) {
        matchedPattern = pattern
        break
      }
    }

    if (matchedPattern) {
      ;(req as any)._probeBlocked = true
      if (silent) {
        ;(req as any)._silentLog = true
      }

      if (typeof onProbe === 'function') {
        try {
          onProbe(req, res, matchedPattern)
        } catch {
          /* ignore hook error */
        }
      }

      if (blackhole) {
        if (!res.headersSent) {
          res.status(statusCode).send(options.message || '')
        }
        return
      }

      return next(
        new HttpError(
          options.message || 'Forbidden',
          statusCode,
          'PROBE_BLOCKED'
        )
      )
    }

    next()
  }
}

export const blockProbes = blockSuspiciousProbes
