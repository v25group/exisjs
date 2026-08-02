import type { ErrorHandler, Handler } from '../types'

// ─── HttpError ─────────────────────────────────────────────────────────────────

export class HttpError extends Error {
  public readonly statusCode: number
  public readonly code: string
  public readonly isOperational: boolean
  public readonly details?: unknown

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    details?: unknown
  ) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.code = code
    this.isOperational = true
    this.details = details

    // maintains proper stack trace
    Error.captureStackTrace(this, this.constructor)
  }

  // ─── Factory methods ─────────────────────────────────────────────────────────

  static badRequest(message: string, details?: unknown): HttpError {
    return new HttpError(message, 400, 'BAD_REQUEST', details)
  }

  static unauthorized(message = 'Unauthorized'): HttpError {
    return new HttpError(message, 401, 'UNAUTHORIZED')
  }

  static forbidden(message = 'Forbidden'): HttpError {
    return new HttpError(message, 403, 'FORBIDDEN')
  }

  static notFound(resource = 'Resource'): HttpError {
    return new HttpError(`${resource} not found`, 404, 'NOT_FOUND')
  }

  static conflict(message: string): HttpError {
    return new HttpError(message, 409, 'CONFLICT')
  }

  static unprocessable(message: string, details?: unknown): HttpError {
    return new HttpError(message, 422, 'UNPROCESSABLE_ENTITY', details)
  }

  static tooManyRequests(message = 'Too many requests'): HttpError {
    return new HttpError(message, 429, 'RATE_LIMITED')
  }

  static internal(message = 'Internal server error'): HttpError {
    return new HttpError(message, 500, 'INTERNAL_ERROR')
  }

  static serviceUnavailable(message = 'Service unavailable'): HttpError {
    return new HttpError(message, 503, 'SERVICE_UNAVAILABLE')
  }

  toJSON(): object {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined && { details: this.details }),
      },
    }
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Bad Request', details?: unknown) {
    super(message, 400, 'BAD_REQUEST', details)
    this.name = 'BadRequestError'
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED')
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN')
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends HttpError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND')
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'Conflict') {
    super(message, 409, 'CONFLICT')
    this.name = 'ConflictError'
  }
}

export class UnprocessableError extends HttpError {
  constructor(message = 'Unprocessable Entity', details?: unknown) {
    super(message, 422, 'UNPROCESSABLE_ENTITY', details)
    this.name = 'UnprocessableError'
  }
}

export class RateLimitError extends HttpError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMITED')
    this.name = 'RateLimitError'
  }
}

export class InternalError extends HttpError {
  constructor(message = 'Internal server error') {
    super(message, 500, 'INTERNAL_ERROR')
    this.name = 'InternalError'
  }
}

// ─── Exception Aliases ────────────────────────────────────────────────────────
export const HttpException = HttpError
export const BadRequestException = BadRequestError
export const UnauthorizedException = UnauthorizedError
export const ForbiddenException = ForbiddenError
export const NotFoundException = NotFoundError
export const ConflictException = ConflictError
export const UnprocessableException = UnprocessableError
export const RateLimitException = RateLimitError
export const InternalException = InternalError

// ─── Global Error Handler ─────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  if (typeof str !== 'string') return String(str)
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderErrorHtml(err: Error, req: import('../types').Request): string {
  const stack = err.stack
    ? escapeHtml(err.stack)
        .replace(/\n/g, '<br/>')
        .replace(/ {2}/g, '&nbsp;&nbsp;')
    : 'No stack trace available.'
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unhandled Error | Exis</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #fcebeb; color: #333; margin: 0; padding: 40px; }
    .container { max-width: 900px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 10px 25px rgba(200, 0, 0, 0.1); border-left: 6px solid #e53e3e; }
    h1 { color: #e53e3e; margin-top: 0; font-size: 24px; }
    .message { font-size: 18px; font-weight: 500; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid #eee; }
    .code-block { background: #1e1e1e; color: #d4d4d4; padding: 20px; border-radius: 6px; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 14px; line-height: 1.5; }
    .req-info { margin-top: 20px; font-size: 14px; color: #666; }
    .highlight { color: #e53e3e; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Unhandled Server Error</h1>
    <div class="message">${escapeHtml(err.message || 'Unknown Error')}</div>
    <div class="code-block">${stack}</div>
    <div class="req-info">
      <strong>Request:</strong> <span class="highlight">${escapeHtml(req.method)}</span> ${escapeHtml(req.path)}
    </div>
  </div>
</body>
</html>
  `.trim()
}

export function createErrorHandler(isDev = false): ErrorHandler {
  return (err, req, res, _next) => {
    if (res.headersSent) return

    // known operational error
    if (err instanceof HttpError) {
      if (
        isDev &&
        req.headers.accept?.includes('text/html') &&
        err.statusCode >= 500
      ) {
        res.status(err.statusCode).html(renderErrorHtml(err, req))
        return
      }
      res.status(err.statusCode).json(err.toJSON())
      return
    }

    if (
      err.name === 'ZodError' ||
      err.name === 'ValidationError' ||
      err.name === 'ValidatorError'
    ) {
      let message = err.message

      // Normalize ZodError
      if (
        err.name === 'ZodError' &&
        'errors' in err &&
        Array.isArray((err as any).errors)
      ) {
        const zodErrors = (err as any).errors
        message =
          'Validation Error: ' +
          zodErrors
            .map((e: any) => `${e.path.join('.')}: ${e.message}`)
            .join(', ')
      }
      // Normalize Yup ValidationError
      else if (
        err.name === 'ValidationError' &&
        'inner' in err &&
        Array.isArray((err as any).inner) &&
        (err as any).inner.length > 0
      ) {
        const yupErrors = (err as any).inner
        message =
          'Validation Error: ' +
          yupErrors.map((e: any) => `${e.path}: ${e.message}`).join(', ')
      }

      res.status(400).json({
        statusCode: 400,
        error: 'Bad Request',
        message,
      })
      return
    }

    // syntax error in body
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: 'Invalid JSON in request body',
        },
      })
      return
    }

    // unknown error — don't leak internals in production
    if (req.log) {
      req.log.error({ err }, 'unhandled server error')
    }
    if (isDev) {
      console.error('\n\x1b[31m[Exis Unhandled Error]\x1b[0m', err, '\n')
    } else if (!req.log) {
      console.error('[Exis Error]', err)
    }

    if (isDev && req.headers.accept?.includes('text/html')) {
      res
        .status(500)
        .html(
          renderErrorHtml(
            err instanceof Error ? err : new Error(String(err)),
            req
          )
        )
      return
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: isDev ? err.message : 'An unexpected error occurred',
        ...(isDev && { stack: err.stack }),
      },
    })
  }
}

/**
 * Async handler wrapper — catches promise rejections.
 * Note: Exis automatically handles async promise rejections internally.
 * This is kept solely for API compatibility with Express middleware.
 * It is redundant and adds unnecessary Promise allocations.
 */
export function asyncHandler(fn: Handler): Handler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
