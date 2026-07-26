import {
  HttpError,
  createErrorHandler,
  asyncHandler,
} from '../src/utils/errors'
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  getResponseBody,
} from './helpers'
import { describe, it, expect } from '../src/testing'

// ─── HttpError Class ──────────────────────────────────────────────────────────

describe('HttpError', () => {
  it('constructs with correct properties', () => {
    const err = new HttpError('Something went wrong', 500, 'INTERNAL_ERROR')
    expect(err.message).toBe('Something went wrong')
    expect(err.statusCode).toBe(500)
    expect(err.code).toBe('INTERNAL_ERROR')
    expect(err.isOperational).toBe(true)
    expect(err.name).toBe('HttpError')
    expect(err).toBeInstanceOf(Error)
    expect(err.stack).toBeDefined()
  })

  it('stores details', () => {
    const details = { field: 'email', reason: 'invalid' }
    const err = new HttpError('Bad input', 400, 'BAD_REQUEST', details)
    expect(err.details).toEqual(details)
  })

  it('defaults to 500 INTERNAL_ERROR', () => {
    const err = new HttpError('oops')
    expect(err.statusCode).toBe(500)
    expect(err.code).toBe('INTERNAL_ERROR')
  })
})

// ─── Factory Methods ──────────────────────────────────────────────────────────

describe('HttpError factory methods', () => {
  it('badRequest() → 400', () => {
    const err = HttpError.badRequest('Invalid input', { field: 'email' })
    expect(err.statusCode).toBe(400)
    expect(err.code).toBe('BAD_REQUEST')
    expect(err.message).toBe('Invalid input')
    expect(err.details).toEqual({ field: 'email' })
  })

  it('unauthorized() → 401', () => {
    const err = HttpError.unauthorized()
    expect(err.statusCode).toBe(401)
    expect(err.code).toBe('UNAUTHORIZED')
    expect(err.message).toBe('Unauthorized')
  })

  it('forbidden() → 403', () => {
    const err = HttpError.forbidden()
    expect(err.statusCode).toBe(403)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('notFound() → 404 with resource name', () => {
    const err = HttpError.notFound('User')
    expect(err.statusCode).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('User not found')
  })

  it('notFound() default message', () => {
    const err = HttpError.notFound()
    expect(err.message).toBe('Resource not found')
  })

  it('conflict() → 409', () => {
    const err = HttpError.conflict('Email already exists')
    expect(err.statusCode).toBe(409)
    expect(err.code).toBe('CONFLICT')
  })

  it('unprocessable() → 422', () => {
    const details = [{ path: 'email', message: 'invalid' }]
    const err = HttpError.unprocessable('Invalid data', details)
    expect(err.statusCode).toBe(422)
    expect(err.code).toBe('UNPROCESSABLE_ENTITY')
    expect(err.details).toEqual(details)
  })

  it('tooManyRequests() → 429', () => {
    const err = HttpError.tooManyRequests()
    expect(err.statusCode).toBe(429)
    expect(err.code).toBe('RATE_LIMITED')
  })

  it('internal() → 500', () => {
    const err = HttpError.internal()
    expect(err.statusCode).toBe(500)
    expect(err.code).toBe('INTERNAL_ERROR')
  })

  it('serviceUnavailable() → 503', () => {
    const err = HttpError.serviceUnavailable()
    expect(err.statusCode).toBe(503)
    expect(err.code).toBe('SERVICE_UNAVAILABLE')
  })
})

// ─── toJSON ───────────────────────────────────────────────────────────────────

describe('HttpError.toJSON()', () => {
  it('returns structured error without details', () => {
    const err = HttpError.notFound('User')
    expect(err.toJSON()).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'User not found' },
    })
  })

  it('includes details when present', () => {
    const err = HttpError.badRequest('Bad', { field: 'name' })
    const json = err.toJSON() as { error: { details: unknown } }
    expect(json.error.details).toEqual({ field: 'name' })
  })
})

// ─── createErrorHandler ───────────────────────────────────────────────────────

describe('createErrorHandler()', () => {
  it('handles HttpError with correct status and JSON', () => {
    const handler = createErrorHandler(false)
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    handler(HttpError.notFound('User'), req, res, next)

    expect(res.statusCode).toBe(404)
    const body = getResponseBody(res)
    expect(body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'User not found' },
    })
  })

  it('handles ValidationError (ZodError-like) → 400', () => {
    const handler = createErrorHandler(false)
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    const err = new Error('Validation failed') as Error & { errors: unknown[] }
    err.name = 'ZodError'
    err.errors = [{ path: ['email'], message: 'Invalid' }]

    handler(err, req, res, next)

    expect(res.statusCode).toBe(400)
    const body = getResponseBody(res) as never
    expect((body as any).error).toBe('Bad Request')
  })

  it('handles ValidatorError (native) → 400', () => {
    const handler = createErrorHandler(false)
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    const err = new Error('Validation failed') as Error & { errors: unknown[] }
    err.name = 'ValidationError'
    err.errors = [{ path: 'email', message: 'Required' }]

    handler(err, req, res, next)

    expect(res.statusCode).toBe(400)
  })

  it('handles SyntaxError from bad JSON → 400', () => {
    const handler = createErrorHandler(false)
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    const err = new SyntaxError('Unexpected token') as SyntaxError & {
      body: string
    }
    ;(err as any).body = 'invalid json'

    handler(err, req, res, next)

    expect(res.statusCode).toBe(400)
    const body = getResponseBody(res) as never
    expect((body as any).error.code).toBe('INVALID_JSON')
  })

  it('hides error details in production mode', () => {
    const handler = createErrorHandler(false) // prod mode
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    handler(new Error('secret internal error'), req, res, next)

    expect(res.statusCode).toBe(500)
    const body = getResponseBody(res) as never
    expect((body as any).error.message).toBe('An unexpected error occurred')
    expect((body as any).error.stack).toBeUndefined()
  })

  it('shows error details in dev mode as JSON', () => {
    const handler = createErrorHandler(true) // dev mode
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    handler(new Error('debug info'), req, res, next)

    expect(res.statusCode).toBe(500)
    const body = getResponseBody(res) as never
    expect((body as any).error.message).toBe('debug info')
    expect((body as any).error.stack).toBeDefined()
  })

  it('shows HTML error overlay in dev mode if text/html is accepted', () => {
    const handler = createErrorHandler(true)
    const req = createMockRequest({
      headers: { accept: 'text/html,application/xhtml+xml' },
    })
    const res = createMockResponse()
    const next = createMockNext()

    handler(new Error('html debug info'), req, res, next)

    expect(res.statusCode).toBe(500)
    expect(res._body).toContain('html debug info')
    expect(res._body).toContain('<!DOCTYPE html>')
  })

  it('no-ops when headers already sent', () => {
    const handler = createErrorHandler(false)
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    // Simulate headers already sent
    res.end('already sent')
    const bodyBefore = res._body

    handler(new Error('test'), req, res, next)

    // Body should not change
    expect(res._body).toBe(bodyBefore)
  })
})

// ─── asyncHandler ─────────────────────────────────────────────────────────────

describe('asyncHandler()', () => {
  it('catches async errors and calls next(err)', async () => {
    const error = new Error('async failure')
    const handler = asyncHandler(async () => {
      throw error
    })

    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    await handler(req, res, next)

    expect(next).toHaveBeenCalledWith(error)
  })

  it('does not call next on success', async () => {
    const handler = asyncHandler(async (_req, res) => {
      res.json({ ok: true })
    })

    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
  })
})
