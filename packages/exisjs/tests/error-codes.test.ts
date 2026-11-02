import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  ForbiddenException,
  GatewayTimeoutError,
  HttpError,
  InternalError,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitError,
  ServiceUnavailableError,
  UnauthorizedError,
  UnprocessableError,
} from '../src/error'
import { describe, it, expect } from '../src/testing'

describe('error codes', () => {
  const classes = [
    [BadRequestError, 400, 'BAD_REQUEST'],
    [UnauthorizedError, 401, 'UNAUTHORIZED'],
    [ForbiddenError, 403, 'FORBIDDEN'],
    [NotFoundError, 404, 'NOT_FOUND'],
    [ConflictError, 409, 'CONFLICT'],
    [PayloadTooLargeError, 413, 'PAYLOAD_TOO_LARGE'],
    [UnprocessableError, 422, 'UNPROCESSABLE_ENTITY'],
    [RateLimitError, 429, 'RATE_LIMITED'],
    [InternalError, 500, 'INTERNAL_ERROR'],
    [ServiceUnavailableError, 503, 'SERVICE_UNAVAILABLE'],
    [GatewayTimeoutError, 504, 'GATEWAY_TIMEOUT'],
  ] as const

  for (const [ErrorClass, status, code] of classes) {
    it(`${ErrorClass.name} takes a code and details`, () => {
      const err = new ErrorClass('Nope', {
        code: 'DOMAIN_CODE',
        details: { id: 1 },
      })

      expect(err.statusCode).toBe(status)
      expect(err.code).toBe('DOMAIN_CODE')
      expect(err.details).toEqual({ id: 1 })
    })

    it(`${ErrorClass.name} keeps its default code`, () => {
      const err = new ErrorClass('Nope')

      expect(err.statusCode).toBe(status)
      expect(err.code).toBe(code)
      expect(err.details).toBeUndefined()
    })
  }

  it('sends the code in the error envelope', () => {
    const err = new ConflictError('Changed by someone else', {
      code: 'STALE_RECORD',
    })

    expect(err.toJSON()).toEqual({
      success: false,
      statusCode: 409,
      error: { code: 'STALE_RECORD', message: 'Changed by someone else' },
    })
  })

  it('keeps the not-found message wording with a code', () => {
    const err = new NotFoundError('Lead', { code: 'LEAD_NOT_FOUND' })

    expect(err.message).toBe('Lead not found')
    expect(err.code).toBe('LEAD_NOT_FOUND')
  })

  it('passes options through the exception aliases', () => {
    const err = new ForbiddenException('No', { code: 'ACCOUNT_SUSPENDED' })

    expect(err.code).toBe('ACCOUNT_SUSPENDED')
    expect(err).toBeInstanceOf(ForbiddenError)
  })

  it('passes options through the factory methods', () => {
    expect(HttpError.notFound('Lead', { code: 'X' }).code).toBe('X')
    expect(HttpError.conflict('c', { code: 'X' }).code).toBe('X')
    expect(HttpError.forbidden('f', { code: 'X' }).code).toBe('X')
    expect(HttpError.unauthorized('u', { code: 'X' }).code).toBe('X')
    expect(HttpError.badRequest('b', { code: 'X' }).code).toBe('X')
    expect(HttpError.unprocessable('r', { code: 'X' }).code).toBe('X')
    expect(HttpError.payloadTooLarge('p', { code: 'X' }).code).toBe('X')
    expect(HttpError.tooManyRequests('t', { code: 'X' }).code).toBe('X')
    expect(HttpError.internal('i', { code: 'X' }).code).toBe('X')
    expect(HttpError.serviceUnavailable('s', { code: 'X' }).code).toBe('X')
    expect(HttpError.gatewayTimeout('g', { code: 'X' }).code).toBe('X')
  })

  it('factories keep their defaults and class', () => {
    const err = HttpError.notFound()

    expect(err.message).toBe('Resource not found')
    expect(err.code).toBe('NOT_FOUND')
    expect(err).toBeInstanceOf(NotFoundError)
  })

  describe('classes that already take details second', () => {
    for (const ErrorClass of [
      BadRequestError,
      UnprocessableError,
      PayloadTooLargeError,
    ]) {
      it(`${ErrorClass.name} still reads other values as details`, () => {
        for (const details of [
          { field: 'email' },
          { code: 'X', field: 'email' },
          { code: 42 },
          ['a', 'b'],
          'text',
          0,
        ]) {
          const err = new ErrorClass('Nope', details)
          expect(err.details).toEqual(details)
          expect(err.code).not.toBe('X')
        }
      })
    }

    it('reads an empty object as details', () => {
      expect(new BadRequestError('Nope', {}).details).toEqual({})
    })

    it('reads a class instance as details', () => {
      class Report {
        code = 'X'
      }
      const report = new Report()
      const err = new BadRequestError('Nope', report)

      expect(err.details).toBe(report)
      expect(err.code).toBe('BAD_REQUEST')
    })
  })
})
