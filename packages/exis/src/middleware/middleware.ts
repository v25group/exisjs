import type { Handler, CorsConfig, LoggerConfig, Logger } from '../types'
import { ObjectValidator, ValidatorError } from '../utils/validator'
import { createLogger, isLogger } from '../utils/logger'

// ─── CORS ─────────────────────────────────────────────────────────────────────

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
    credentials = false,
    maxAge = 86400,
  } = config

  return (req, res, next) => {
    const reqOrigin = req.get('origin')

    // 1. Resolve Origin
    let allowOrigin = ''
    if (origin === '*') {
      allowOrigin = '*'
    } else if (typeof origin === 'string') {
      allowOrigin = origin
    } else if (reqOrigin) {
      if (Array.isArray(origin)) {
        allowOrigin = origin.some((o) =>
          o instanceof RegExp ? o.test(reqOrigin) : o === reqOrigin
        )
          ? reqOrigin
          : ''
      } else if (origin instanceof RegExp) {
        allowOrigin = origin.test(reqOrigin) ? reqOrigin : ''
      } else if (typeof origin === 'function') {
        allowOrigin = origin(reqOrigin) ? reqOrigin : ''
      }
    }

    if (allowOrigin) {
      res.set('Access-Control-Allow-Origin', allowOrigin)
    }

    // 2. Credentials
    if (credentials) {
      res.set('Access-Control-Allow-Credentials', 'true')
    }

    // 3. Exposed Headers
    if (exposedHeaders && exposedHeaders.length > 0) {
      res.set('Access-Control-Expose-Headers', exposedHeaders.join(', '))
    }

    // 4. Preflight (OPTIONS)
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', methods.join(', '))

      const reqHeaders = req.get('access-control-request-headers')
      if (reqHeaders) {
        res.set('Access-Control-Allow-Headers', reqHeaders)
      } else if (allowedHeaders && allowedHeaders.length > 0) {
        res.set('Access-Control-Allow-Headers', allowedHeaders.join(', '))
      }

      if (maxAge) {
        res.set('Access-Control-Max-Age', String(maxAge))
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
}

// ─── Request ID ───────────────────────────────────────────────────────────────

let reqIdCounter = 0

export function requestId(): Handler {
  return (req, res, next) => {
    const h = req.raw.headers
    const id = (h['x-request-id'] || h['traceparent'] || h['x-b3-traceid']) as
      string | undefined
    const finalId = id
      ? id.startsWith('00-')
        ? id.split('-')[1]
        : id
      : `req-${++reqIdCounter}`

    req.requestId = finalId
    res.setHeader('X-Request-Id', finalId)
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

    // Create request-scoped child logger with context
    req.log = log.child({
      requestId: req.requestId,
      method: req.method,
      url: req.path,
    })

    // Use _onFinish to capture response timing without deoptimizing V8 hidden classes
    res._onFinish.push(() => {
      const responseTime = Date.now() - start
      const logData = { statusCode: res.statusCode, responseTime }

      if (res.statusCode >= 500) {
        req.log.error(logData, `${req.method} ${req.path}`)
      } else if (res.statusCode >= 400) {
        // Silently ignore favicon 404s to reduce noise
        if (req.path === '/favicon.ico' && res.statusCode === 404) {
          // ignore
        } else {
          req.log.warn(logData, `${req.method} ${req.path}`)
        }
      } else {
        req.log.info(logData, `${req.method} ${req.path}`)
      }
    })

    next()
  }
}

// ─── Not Found Handler ────────────────────────────────────────────────────────

export const notFound: Handler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.path}`,
    },
  })
}

// ─── Static File Serving ────────────────────────────────────────────────────────

export { compression } from './compression'
export {
  helmet,
  csrf,
  timeout,
  hpp,
  xss,
  mongoSanitize,
  sqlSanitize,
  dbSanitize,
} from './security'
export { cacheMiddleware as cache } from './cache'
export { dedupeMiddleware as dedupe } from './dedupe'
export { backpressureMiddleware as backpressure } from './backpressure'
export { ipFilterMiddleware as ipFilter } from './ip-filter'
export { intercept } from './interceptor'
export { catchError } from './exception-filter'
export * from './guard'
export * from './pipe'

export function serveStatic(
  root: string,
  options: { maxAge?: number } = {}
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

      fs.stat(
        filePath,
        (err: NodeJS.ErrnoException | null, stat: import('node:fs').Stats) => {
          if (err || !stat.isFile()) {
            return next()
          }

          const ext = path.extname(filePath).toLowerCase()
          const mime = mimeTypes[ext] || 'application/octet-stream'

          res.set('Content-Type', mime)
          res.set('Content-Length', String(stat.size))

          if (options.maxAge !== undefined) {
            res.set('Cache-Control', `public, max-age=${options.maxAge}`)
          }

          if (req.method === 'HEAD') {
            res.status(200).send('')
            return
          }

          const sendStream = fs.createReadStream(filePath)
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
  body?: ObjectValidator<any>

  query?: ObjectValidator<any>

  params?: ObjectValidator<any>
}

export function validate(schema: ValidateSchema): Handler {
  const handler: Handler = async (req, res, next) => {
    try {
      if (schema.body) {
        req.body = schema.body.parse(req.body)
      }
      if (schema.query) {
        req.query = schema.query.parse(req.query)
      }
      if (schema.params) {
        req.params = schema.params.parse(req.params)
      }
      next()
    } catch (err: unknown) {
      if (err instanceof ValidatorError) {
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
