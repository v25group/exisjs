import fs from 'node:fs'
import type { ErrorHandler, Handler } from '../types'
import { logger } from '../logger'

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

  static payloadTooLarge(
    message = 'Payload too large',
    details?: unknown
  ): HttpError {
    return new HttpError(message, 413, 'PAYLOAD_TOO_LARGE', details)
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

  static gatewayTimeout(message = 'Gateway timeout'): HttpError {
    return new HttpError(message, 504, 'GATEWAY_TIMEOUT')
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

export class PayloadTooLargeError extends HttpError {
  constructor(message = 'Payload Too Large', details?: unknown) {
    super(message, 413, 'PAYLOAD_TOO_LARGE', details)
    this.name = 'PayloadTooLargeError'
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

export class ServiceUnavailableError extends HttpError {
  constructor(message = 'Service unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE')
    this.name = 'ServiceUnavailableError'
  }
}

export class GatewayTimeoutError extends HttpError {
  constructor(message = 'Gateway timeout') {
    super(message, 504, 'GATEWAY_TIMEOUT')
    this.name = 'GatewayTimeoutError'
  }
}

// ─── Exception Aliases ────────────────────────────────────────────────────────
export const HttpException = HttpError
export const BadRequestException = BadRequestError
export const UnauthorizedException = UnauthorizedError
export const ForbiddenException = ForbiddenError
export const NotFoundException = NotFoundError
export const ConflictException = ConflictError
export const PayloadTooLargeException = PayloadTooLargeError
export const UnprocessableException = UnprocessableError
export const RateLimitException = RateLimitError
export const InternalException = InternalError
export const ServiceUnavailableException = ServiceUnavailableError
export const GatewayTimeoutException = GatewayTimeoutError

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

function buildHtmlCodeFrame(err: Error): string {
  if (!err.stack) return ''
  const stackLines = err.stack.split('\n')
  let file = '',
    line = 0

  for (const sl of stackLines) {
    const match =
      sl.match(/\((.+):(\d+):(\d+)\)/) ||
      sl.match(/at\s+(.+):(\d+):(\d+)/) ||
      sl.match(/^(.+\.tsx?):(\d+):(\d+)/)
    if (
      match &&
      !match[1].includes('node_modules') &&
      !match[1].includes('node:')
    ) {
      file = match[1]
      line = parseInt(match[2], 10)
      break
    }
  }

  if (!file || !line) return ''

  try {
    const source = fs.readFileSync(file, 'utf-8')
    const lines = source.split('\n')
    const start = Math.max(0, line - 5)
    const end = Math.min(lines.length, line + 4)

    let html = `<div style="margin-bottom: 12px; font-weight: bold; color: #a0aec0; font-family: monospace;">${escapeHtml(file)}:${line}</div>`
    html += `<div style="background: #1e1e1e; padding: 15px 0; border-radius: 6px; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace; font-size: 14px; line-height: 1.5; color: #d4d4d4;">`

    for (let i = start; i < end; i++) {
      const isErrorLine = i + 1 === line
      const lineNum = String(i + 1).padStart(4, ' ')
      const escapedLine = escapeHtml(lines[i]) || ' '
      if (isErrorLine) {
        html += `<div style="background: rgba(229, 62, 62, 0.2); display: flex; padding: 2px 15px; color: #fc8181; border-left: 4px solid #fc8181;"><span style="color: #718096; margin-right: 15px; user-select: none;">${lineNum} |</span><span style="white-space: pre;">${escapedLine}</span></div>`
      } else {
        html += `<div style="display: flex; padding: 2px 15px; border-left: 4px solid transparent;"><span style="color: #718096; margin-right: 15px; user-select: none;">${lineNum} |</span><span style="white-space: pre;">${escapedLine}</span></div>`
      }
    }
    html += `</div>`
    return html
  } catch {
    return ''
  }
}

function renderErrorHtml(err: Error, req: import('../types').Request): string {
  const stack = err.stack
    ? escapeHtml(err.stack)
        .replace(/\n/g, '<br/>')
        .replace(/ {2}/g, '&nbsp;&nbsp;')
    : 'No stack trace available.'

  const codeFrame = buildHtmlCodeFrame(err)

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
    .message { font-size: 18px; font-weight: 500; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #eee; }
    .stack-block { background: #f8f9fa; color: #4a5568; padding: 20px; border-radius: 6px; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 13px; line-height: 1.5; border: 1px solid #e2e8f0; margin-top: 20px; }
    .req-info { margin-top: 25px; font-size: 14px; color: #666; background: #f7fafc; padding: 15px; border-radius: 6px; border: 1px solid #edf2f7; }
    .highlight { color: #e53e3e; font-weight: bold; background: #fed7d7; padding: 2px 6px; border-radius: 4px; }
    .code-section { margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Unhandled Server Error</h1>
    <div class="message">${escapeHtml(err.message || 'Unknown Error')}</div>
    
    ${codeFrame ? `<div class="code-section">${codeFrame}</div>` : ''}
    
    <div class="stack-block">${stack}</div>
    
    <div class="req-info">
      <strong>Request:</strong> <span class="highlight">${escapeHtml(req.method)}</span> ${escapeHtml(req.path)}
    </div>
  </div>
</body>
</html>
  `.trim()
}

export function renderValidationTable(
  rows: { field: string; received: string; expected: string }[]
): string {
  if (!rows || rows.length === 0) return ''

  const headers = { field: 'Field', received: 'Received', expected: 'Expected' }
  const all = [headers, ...rows]

  const fieldWidth = Math.max(11, ...all.map((r) => String(r.field).length))
  const receivedWidth = Math.max(
    25,
    ...all.map((r) => String(r.received).length)
  )
  const expectedWidth = Math.max(
    16,
    ...all.map((r) => String(r.expected).length)
  )

  const pad = (s: string, w: number) =>
    s + ' '.repeat(Math.max(0, w - s.length))

  const top = `┌─${'─'.repeat(fieldWidth)}─┬─${'─'.repeat(receivedWidth)}─┬─${'─'.repeat(expectedWidth)}─┐`
  const headerRow = `│ ${pad(headers.field, fieldWidth)} │ ${pad(headers.received, receivedWidth)} │ ${pad(headers.expected, expectedWidth)} │`
  const sep = `├─${'─'.repeat(fieldWidth)}─┼─${'─'.repeat(receivedWidth)}─┼─${'─'.repeat(expectedWidth)}─┤`
  const dataRows = rows.map(
    (r) =>
      `│ ${pad(String(r.field), fieldWidth)} │ ${pad(String(r.received), receivedWidth)} │ ${pad(String(r.expected), expectedWidth)} │`
  )
  const bot = `└─${'─'.repeat(fieldWidth)}─┴─${'─'.repeat(receivedWidth)}─┴─${'─'.repeat(expectedWidth)}─┘`

  return [top, headerRow, sep, ...dataRows, bot].join('\n')
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
      err.name === 'ValidatorError' ||
      (err &&
        typeof err === 'object' &&
        ('errors' in err || 'issues' in err || 'inner' in err))
    ) {
      let message = err.message
      const errorsMap: Record<string, string> = {}
      const detailsList: {
        field: string
        message: string
        expected?: string
        received?: string
        code?: string
      }[] = []

      // Normalize ZodError / Standard schema issues
      if (
        err.name === 'ZodError' ||
        ('issues' in err && Array.isArray((err as any).issues)) ||
        ('errors' in err &&
          Array.isArray((err as any).errors) &&
          err.name !== 'ValidatorError')
      ) {
        const issues = (err as any).issues || (err as any).errors || []
        for (const issue of issues) {
          const field = Array.isArray(issue.path)
            ? issue.path.join('.')
            : String(issue.path || issue.field || 'general')
          errorsMap[field || 'general'] = issue.message
          detailsList.push({
            field: field || 'general',
            message: issue.message,
            expected: issue.expected || issue.message,
            received:
              issue.received !== undefined ? String(issue.received) : undefined,
            code: issue.code || 'VALIDATION_ERROR',
          })
        }
        if (Object.keys(errorsMap).length > 0) {
          message =
            'Validation Error: ' +
            Object.entries(errorsMap)
              .map(([path, msg]) => `${path}: ${msg}`)
              .join(', ')
        }
      }
      // Normalize Yup ValidationError
      else if (
        err.name === 'ValidationError' &&
        'inner' in err &&
        Array.isArray((err as any).inner) &&
        (err as any).inner.length > 0
      ) {
        for (const e of (err as any).inner) {
          const field = e.path || 'general'
          errorsMap[field] = e.message
          detailsList.push({
            field,
            message: e.message,
            expected: e.type || e.message,
            code: e.type || 'VALIDATION_ERROR',
          })
        }
        message =
          'Validation Error: ' +
          Object.entries(errorsMap)
            .map(([path, msg]) => `${path}: ${msg}`)
            .join(', ')
      }
      // Normalize Tex ValidatorError
      else if (
        err.name === 'ValidatorError' &&
        'errors' in err &&
        Array.isArray((err as any).errors)
      ) {
        for (const e of (err as any).errors) {
          const field = e.path || 'general'
          errorsMap[field] = e.message
          detailsList.push({
            field,
            message: e.message,
            expected: e.expected || e.message,
            received: e.received,
            code: e.code || 'VALIDATION_ERROR',
          })
        }
        message = 'Validation Error'
      } else if (
        (err as any).errors &&
        typeof (err as any).errors === 'object' &&
        !Array.isArray((err as any).errors)
      ) {
        Object.assign(errorsMap, (err as any).errors)
        for (const [field, msg] of Object.entries((err as any).errors)) {
          detailsList.push({
            field,
            message: String(msg),
            expected: String(msg),
            code: 'VALIDATION_ERROR',
          })
        }
      }

      // Terminal diagnostic logging
      const part = (err as any).httpPart
        ? ` (part: ${(err as any).httpPart})`
        : ''
      const routeLoc = (err as any).routePath
        ? `${(err as any).routeMethod || req.method} ${(err as any).routePath}`
        : `${req.method} ${req.url || req.path || ''}`

      const receivedSource =
        (err as any).received !== undefined
          ? (err as any).received
          : (err as any).httpPart === 'query'
            ? req.query
            : (err as any).httpPart === 'params'
              ? req.params
              : (err as any).httpPart === 'headers'
                ? req.headers
                : req.body

      const tableRows: {
        field: string
        received: string
        expected: string
        code?: string
      }[] = []

      for (const [field, expectedMsg] of Object.entries(errorsMap)) {
        const itemDetail = detailsList.find((d) => d.field === field)
        let formattedReceived = itemDetail?.received

        if (formattedReceived === undefined) {
          let rawReceived: any
          if (receivedSource && typeof receivedSource === 'object') {
            if (field in receivedSource) {
              rawReceived = receivedSource[field]
            } else {
              try {
                const parts = field.replace(/\[(\w+)\]/g, '.$1').split('.')
                let curr = receivedSource
                for (const p of parts) {
                  if (curr === undefined || curr === null) break
                  curr = curr[p]
                }
                rawReceived = curr
              } catch {
                rawReceived = undefined
              }
            }
          }

          if (rawReceived === undefined) {
            formattedReceived = 'undefined'
          } else if (rawReceived === null) {
            formattedReceived = 'null'
          } else if (typeof rawReceived === 'string') {
            formattedReceived = JSON.stringify(rawReceived)
          } else if (
            typeof rawReceived === 'number' ||
            typeof rawReceived === 'boolean'
          ) {
            formattedReceived = String(rawReceived)
          } else if (typeof rawReceived === 'object') {
            try {
              formattedReceived = JSON.stringify(rawReceived)
            } catch {
              formattedReceived = '[object Object]'
            }
          } else {
            formattedReceived = String(rawReceived)
          }
        }

        tableRows.push({
          field,
          received: formattedReceived,
          expected: itemDetail?.expected || expectedMsg,
          code: itemDetail?.code,
        })
      }

      const diagnosticLines = Object.entries(errorsMap).map(
        ([f, msg]) => `  ✖ ${f}: ${msg}`
      )
      const table = renderValidationTable(tableRows)
      const diagnosticMsg = `[Validation Failed] ${routeLoc}${part}\n${diagnosticLines.join('\n')}\n${table}`

      if (req.log && typeof req.log.warn === 'function') {
        req.log.warn(
          {
            validationErrors: errorsMap,
            validationTable: tableRows,
            httpPart: (err as any).httpPart,
            routePath: (err as any).routePath,
            routeMethod: (err as any).routeMethod,
          },
          diagnosticMsg
        )
      } else if (process.env.NODE_ENV !== 'test') {
        console.warn(`\x1b[33m${diagnosticMsg}\x1b[0m`)
      }

      // Attach diagnostic info to request for downstream middlewares/loggers
      ;(req as any)._validationError = {
        errors: errorsMap,
        httpPart: (err as any).httpPart,
        details: tableRows,
      }

      const responseDetails = tableRows.map((r) => ({
        field: r.field,
        message: errorsMap[r.field] || r.expected,
        expected: r.expected,
        received: r.received,
        code: r.code || 'VALIDATION_ERROR',
        httpPart: (err as any).httpPart,
      }))

      res.status(400).json({
        statusCode: 400,
        error: 'Bad Request',
        message: message || 'Validation Error',
        errors: errorsMap,
        details: responseDetails,
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
    ;(req as any)._error = err
    if (req.log) {
      req.log.error({ err }, 'unhandled server error')
    } else {
      logger.error({ err }, 'unhandled server error')
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
