import type {
  Handler,
  CorsConfig,
  LoggerConfig,
  Logger,
  Request,
  Response,
} from '../types'
import {
  TexEngine,
  ValidatorError as NewValidatorError,
} from '../validator/tex'
import { createLogger, isLogger } from '../utils/logger'

// ─── CORS ─────────────────────────────────────────────────────────────────────

let warnedWildcardCredentials = false

export function cors(config: CorsConfig = {}): Handler {
  const {
    origin = '*',
    methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders = [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
    ],
    exposedHeaders,
    maxAge = 86400,
  } = config

  // Browsers reject "Access-Control-Allow-Origin: *" together with
  // credentials, and reflecting any origin with credentials would let every
  // site act as the logged-in user. Credentials need an explicit origin list.
  let credentials = config.credentials === true
  if (credentials && origin === '*') {
    credentials = false
    if (!warnedWildcardCredentials) {
      warnedWildcardCredentials = true
      createLogger({ level: 'warn' }).warn(
        "[CORS] 'credentials: true' is ignored while origin is '*'. Set cors.origin to your site's origin(s), for example ['https://app.example.com'], to allow cookies and Authorization headers cross-origin."
      )
    }
  }

  // The allowed origin depends on the request's Origin whenever it is not a
  // fixed string, so shared caches must key on it
  const reflectsOrigin = typeof origin !== 'string' && Boolean(origin)
  const methodsHeader = methods.join(', ')
  const allowedHeadersStr =
    allowedHeaders && allowedHeaders.length > 0 ? allowedHeaders.join(', ') : ''
  const exposedHeadersStr =
    exposedHeaders && exposedHeaders.length > 0 ? exposedHeaders.join(', ') : ''
  const maxAgeStr = maxAge ? String(maxAge) : ''

  // Hoisted out of the request closure so no function is allocated per request
  const applyOriginAndProceed = (
    req: Request,
    res: Response,
    next: (err?: any) => void,
    reqOrigin: string | undefined,
    allowOrigin: string
  ) => {
    if (reflectsOrigin) res.vary('Origin')
    if (allowOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowOrigin)
    }

    // 2. Credentials
    if (credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true')
    }

    // 3. Exposed Headers
    if (exposedHeadersStr) {
      res.setHeader('Access-Control-Expose-Headers', exposedHeadersStr)
    }

    // 4. Preflight (OPTIONS)
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', methodsHeader)

      const reqHeaders = req.get('access-control-request-headers')
      if (reqHeaders) {
        res.setHeader('Access-Control-Allow-Headers', reqHeaders)
      } else if (allowedHeadersStr) {
        res.setHeader('Access-Control-Allow-Headers', allowedHeadersStr)
      }

      if (maxAgeStr) {
        res.setHeader('Access-Control-Max-Age', maxAgeStr)
      }

      if (!allowOrigin && reqOrigin) {
        if (req.log && typeof req.log.warn === 'function') {
          req.log.warn(
            { origin: reqOrigin },
            `[CORS] Rejected preflight request from origin '${reqOrigin}' (not in allowed origins)`
          )
        }
      }

      if (config.preflightContinue) {
        next()
        return
      }

      res.status(204).send('')
      return
    }

    next()
  }

  return (req, res, next) => {
    if (origin === '*' || !origin) {
      applyOriginAndProceed(
        req,
        res,
        next,
        undefined,
        origin === '*' ? '*' : ''
      )
      return
    }

    if (typeof origin === 'string') {
      applyOriginAndProceed(req, res, next, undefined, origin)
      return
    }

    const reqOrigin = req.get('origin')

    if (!reqOrigin) {
      applyOriginAndProceed(req, res, next, reqOrigin, '')
      return
    }

    if (Array.isArray(origin)) {
      const matched = origin.some((o) =>
        o instanceof RegExp ? o.test(reqOrigin) : o === reqOrigin
      )
      applyOriginAndProceed(req, res, next, reqOrigin, matched ? reqOrigin : '')
      return
    }

    if (origin instanceof RegExp) {
      applyOriginAndProceed(
        req,
        res,
        next,
        reqOrigin,
        origin.test(reqOrigin) ? reqOrigin : ''
      )
      return
    }

    if (typeof origin === 'function') {
      // Check if function accepts a callback (origin, callback)
      if (origin.length >= 2) {
        try {
          origin(reqOrigin, (err, allow) => {
            if (err) return next(err)
            applyOriginAndProceed(
              req,
              res,
              next,
              reqOrigin,
              allow ? reqOrigin : ''
            )
          })
        } catch (err) {
          next(err as Error)
        }
        return
      }

      try {
        const result = origin(reqOrigin)
        if (result && typeof (result as any).then === 'function') {
          ;(result as Promise<boolean>)
            .then((allow) =>
              applyOriginAndProceed(
                req,
                res,
                next,
                reqOrigin,
                allow ? reqOrigin : ''
              )
            )
            .catch(next)
          return
        }
        applyOriginAndProceed(
          req,
          res,
          next,
          reqOrigin,
          result ? reqOrigin : ''
        )
        return
      } catch (err) {
        next(err as Error)
        return
      }
    }

    applyOriginAndProceed(req, res, next, reqOrigin, '')
  }
}

// ─── Request ID ───────────────────────────────────────────────────────────────

let reqIdCounter = 0
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]+$/

// Applied inline by RequestHandler for every request (always on), so it
// does not cost a middleware pipeline stage; requestId() wraps it for users
// who mount it explicitly.
export function assignRequestId(req: Request, res: Response): void {
  const h = req.raw.headers
  const id = (h['x-request-id'] || h['traceparent'] || h['x-b3-traceid']) as
    string | undefined
  const candidate = id
    ? id.startsWith('00-')
      ? id.split('-')[1]
      : id
    : undefined
  // Client-supplied IDs end up in logs and response headers; only accept
  // short token-like values so they cannot forge or bloat log lines
  const finalId =
    candidate !== undefined &&
    candidate.length <= 128 &&
    SAFE_REQUEST_ID.test(candidate)
      ? candidate
      : `req-${++reqIdCounter}`

  req.requestId = finalId
  res.setHeader('X-Request-Id', finalId)
}

export function requestId(): Handler {
  return (req, res, next) => {
    assignRequestId(req, res)
    next()
  }
}

// ─── Request Logger (Pino) ───────────────────────────────────────────────────────

export function requestLogger(
  loggerOrConfig: Logger | LoggerConfig = {}
): Handler {
  const log: Logger = isLogger(loggerOrConfig)
    ? loggerOrConfig
    : createLogger(loggerOrConfig)

  return (req, res, next) => {
    const start = Date.now()

    // Lazy child logger creation — only allocate when req.log is first accessed.
    // Most successful requests never call req.log, saving a Pino child allocation.
    let _childLog: Logger | null = null
    const parentLog = log
    Object.defineProperty(req, 'log', {
      get() {
        if (!_childLog) {
          _childLog = parentLog.child({
            requestId: req.requestId,
            method: req.method,
            url: req.path,
          })
        }
        return _childLog
      },
      set(v: Logger) {
        _childLog = v
      },
      configurable: true,
      enumerable: true,
    })

    // Use _onFinish to capture response timing without deoptimizing V8 hidden classes
    res._onFinish.push(() => {
      const responseTime = Date.now() - start
      const cl = res.getHeader('content-length')
      const contentLength = cl ? parseInt(String(cl), 10) : undefined

      const logData: Record<string, any> = {
        statusCode: res.statusCode,
        responseTime,
        method: req.method,
        url: req.url || req.path,
        contentLength,
        ip: req.ip || (req.raw?.socket as any)?.remoteAddress,
        requestId: req.requestId,
      }
      if ((req as any)._validationError) {
        logData.validation = (req as any)._validationError
      }
      if ((req as any)._error || (res as any)._error) {
        const err = (req as any)._error || (res as any)._error
        logData.error =
          err instanceof Error ? { message: err.message, name: err.name } : err
      }
      // Use child if already created, otherwise use parent with inline context
      const logger = _childLog || parentLog

      if (res.statusCode >= 500) {
        logger.error(logData, `${req.method} ${req.path}`)
      } else if (res.statusCode >= 400) {
        // Silently ignore favicon 404s and probe noise to reduce log clutter
        if (req.path === '/favicon.ico' && res.statusCode === 404) {
          // ignore
        } else if ((req as any)._silentLog || (req as any)._probeBlocked) {
          // ignore scanner probes / silent log requests
        } else {
          logger.warn(logData, `${req.method} ${req.path}`)
        }
      } else {
        logger.info(logData, `${req.method} ${req.path}`)
      }
    })

    next()
  }
}

// ─── Not Found Handler ────────────────────────────────────────────────────────

export const notFound: Handler = (req, res) => {
  res.status(404).json({
    success: false,
    statusCode: 404,
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.path}`,
    },
  })
}

// ─── Static File Serving ────────────────────────────────────────────────────────

export { compression as compress } from './compression'
export {
  helmet,
  csrf,
  timeout,
  hpp,
  mongoSanitize,
  dbSanitize,
  blockSuspiciousProbes,
  blockProbes,
  DEFAULT_PROBE_PATTERNS,
} from './security'
export type {
  CsrfOptions,
  TimeoutOptions,
  DbSanitizeOptions,
  HelmetOptions,
  BlockProbesOptions,
} from './security'
export { rateLimit } from './rate-limit'
export type { RateLimitOptions } from './rate-limit'
export { dedupeMiddleware as dedupe } from './dedupe'
export { backpressureMiddleware as backpressure } from './backpressure'
export { ipFilterMiddleware as ipFilter } from './ip-filter'
export { intercept } from './interceptor'
export { catchError } from './exception-filter'
export { fileUpload, fromExpress } from './upload'
export type { FileUploadOptions, FileUploadLimits } from './upload'
export * from './guard'
export * from './pipe'

export function serveStatic(
  root: string,
  options: {
    maxAge?: number
    etag?: boolean
    brotli?: boolean
    gzip?: boolean
  } = {}
): Handler {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path')
  const rootPath = path.resolve(root)

  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'font/otf',
    '.txt': 'text/plain',
  }

  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next()
    }

    try {
      const decodedPath = decodeURIComponent(req.path)
      const filePath = path.join(rootPath, decodedPath)

      if (!filePath.startsWith(rootPath)) {
        return next()
      }

      const acceptEncoding = (req.headers['accept-encoding'] as string) || ''

      // Check for pre-compressed Brotli or Gzip static file if supported
      let targetPath = filePath
      let contentEncoding: string | null = null

      if (
        options.brotli !== false &&
        acceptEncoding.includes('br') &&
        fs.existsSync(filePath + '.br')
      ) {
        targetPath = filePath + '.br'
        contentEncoding = 'br'
      } else if (
        options.gzip !== false &&
        acceptEncoding.includes('gzip') &&
        fs.existsSync(filePath + '.gz')
      ) {
        targetPath = filePath + '.gz'
        contentEncoding = 'gzip'
      }

      fs.stat(
        targetPath,
        (err: NodeJS.ErrnoException | null, stat: import('node:fs').Stats) => {
          if (err || !stat.isFile()) {
            return next()
          }

          const ext = path.extname(filePath).toLowerCase()
          const mime = mimeTypes[ext] || 'application/octet-stream'

          res.set('Content-Type', mime)
          res.set('Content-Length', String(stat.size))

          if (contentEncoding) {
            res.set('Content-Encoding', contentEncoding)
            res.set('Vary', 'Accept-Encoding')
          }

          if (options.maxAge !== undefined) {
            res.set('Cache-Control', `public, max-age=${options.maxAge}`)
          }

          if (options.etag !== false) {
            // Strong ETag based on mtime and size
            const etag = `"${stat.size.toString(16)}-${stat.mtime.getTime().toString(16)}"`
            res.set('ETag', etag)

            if (req.headers['if-none-match'] === etag) {
              res.status(304).send('')
              return
            }
          }

          if (req.method === 'HEAD') {
            res.status(200).send('')
            return
          }

          const sendStream = fs.createReadStream(targetPath)
          const abortHandler = () => sendStream.destroy()
          req.raw.on('aborted', abortHandler)
          req.raw.on('close', abortHandler)
          res.raw.on('close', abortHandler)
          res.status(200).sendStream(sendStream)
        }
      )
    } catch {
      next()
    }
  }
}

// ─── Native Validation ────────────────────────────────────────────────────────

export interface ValidateSchema {
  body?: TexEngine<any>
  query?: TexEngine<any>
  params?: TexEngine<any>
}

export function validate(schema: ValidateSchema): Handler {
  const handler: Handler = async (req, res, next) => {
    try {
      if (schema.body) {
        req.body = schema.body.parse(req.body)
      }
      if (schema.query) {
        req.query = schema.query.parse(req.query) as Record<string, string>
      }
      if (schema.params) {
        req.params = schema.params.parse(req.params) as Record<string, string>
      }
      next()
    } catch (err: unknown) {
      if (err instanceof NewValidatorError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: err.errors,
          },
        })
        return
      }
      next(err as Error)
    }
  }
  Object.assign(handler, { schema })
  return handler
}

// ─── Conditional Get (ETag) ───────────────────────────────────────────────────

export function conditionalGet(): Handler {
  return (req, res, next) => {
    res.etagEnabled = true
    next()
  }
}

export * from './idempotency'
export * from './upload'
export * from './security'
export * from './rate-limit'
export * from './ip-filter'
export * from './compression'
export * from './backpressure'
export * from './dedupe'
export * from './guard'
export * from './pipe'
export * from './interceptor'
export * from './exception-filter'
