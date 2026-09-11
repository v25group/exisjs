import { describe, expect, it } from '../src/testing'
import { createErrorHandler, renderValidationTable } from '../src/error/errors'
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  getResponseBody,
} from './helpers'
import { Router } from '../src/router/router'
import { tex } from '../src/validator/tex'
import { requestLogger } from '../src/middleware/middleware'

describe('Validation Error Diagnostic Visibility', () => {
  it('formats Tex ValidatorError with structured errors and diagnostic log', () => {
    const handler = createErrorHandler(true)
    const logs: { data?: any; msg?: string }[] = []
    const req = createMockRequest({
      method: 'POST',
      url: '/visits',
    })
    ;(req as any).log = {
      warn: (data: any, msg?: string) => {
        logs.push({ data, msg })
      },
    }
    const res = createMockResponse()
    const next = createMockNext()

    const err: any = new Error('Validation failed')
    err.name = 'ValidatorError'
    err.httpPart = 'body'
    err.errors = [
      { path: 'visitDate', message: 'Expected date string' },
      { path: 'visitorName', message: 'Required field missing' },
    ]

    handler(err, req, res, next)

    expect(res.statusCode).toBe(400)
    const body = getResponseBody<any>(res)
    expect(body.statusCode).toBe(400)
    expect(body.error).toBe('Bad Request')
    expect(body.errors).toEqual({
      visitDate: 'Expected date string',
      visitorName: 'Required field missing',
    })

    // Verify diagnostic log was captured
    expect(logs.length).toBe(1)
    expect(logs[0].msg).toContain(
      '[Validation Failed] POST /visits (part: body)'
    )
    expect(logs[0].msg).toContain('✖ visitDate: Expected date string')
    expect(logs[0].msg).toContain('✖ visitorName: Required field missing')
    expect(logs[0].data?.validationErrors).toEqual({
      visitDate: 'Expected date string',
      visitorName: 'Required field missing',
    })
  })

  it('formats ZodError with path mapping, structured errors, and diagnostics', () => {
    const handler = createErrorHandler(true)
    const logs: { data?: any; msg?: string }[] = []
    const req = createMockRequest({
      method: 'PUT',
      url: '/users/42',
    })
    ;(req as any).log = {
      warn: (data: any, msg?: string) => {
        logs.push({ data, msg })
      },
    }
    const res = createMockResponse()
    const next = createMockNext()

    const err: any = new Error('Zod validation error')
    err.name = 'ZodError'
    err.httpPart = 'body'
    err.issues = [
      { path: ['profile', 'age'], message: 'Expected number, received string' },
      { path: ['email'], message: 'Invalid email address' },
    ]

    handler(err, req, res, next)

    expect(res.statusCode).toBe(400)
    const body = getResponseBody<any>(res)
    expect(body.errors).toEqual({
      'profile.age': 'Expected number, received string',
      email: 'Invalid email address',
    })
    expect(logs.length).toBe(1)
    expect(logs[0].msg).toContain(
      '[Validation Failed] PUT /users/42 (part: body)'
    )
    expect(logs[0].msg).toContain(
      '✖ profile.age: Expected number, received string'
    )
  })

  it('attaches httpPart: body and triggers diagnostic logging via Router pipeline', async () => {
    const router = new Router()
    const BodySchema = tex.object({
      name: tex.string(),
      count: tex.number(),
    })

    router.post('/items', { body: BodySchema }, (req, res) => {
      res.json({ ok: true })
    })

    const req = createMockRequest({
      method: 'POST',
      url: '/items',
      body: { name: 'Widget', count: 'not-a-number' },
    })

    let capturedError: any = null
    const res = createMockResponse()
    await new Promise<void>((resolve) => {
      router.handle(req, res, (err) => {
        capturedError = err
        resolve()
      })
    })

    expect(capturedError).toBeDefined()
    expect(capturedError.httpPart).toBe('body')
  })

  it('attaches httpPart: query on query validation failure', async () => {
    const router = new Router()
    const QuerySchema = tex.object({
      limit: tex.number(),
    })

    router.get('/items', { query: QuerySchema }, (req, res) => {
      res.json({ ok: true })
    })

    const req = createMockRequest({
      method: 'GET',
      url: '/items?limit=abc',
      query: { limit: 'abc' },
    })

    let capturedError: any = null
    const res = createMockResponse()
    await new Promise<void>((resolve) => {
      router.handle(req, res, (err) => {
        capturedError = err
        resolve()
      })
    })

    expect(capturedError).toBeDefined()
    expect(capturedError.httpPart).toBe('query')
  })

  it('includes validation metadata in requestLogger logData when 400 occurs', async () => {
    let loggedData: any = null
    const mockParentLogger: any = {
      warn: (data: any) => {
        loggedData = data
      },
      info: () => {},
      error: () => {},
      child: () => mockParentLogger,
    }

    const mw = requestLogger(mockParentLogger)
    const req = createMockRequest({ method: 'POST', url: '/visits' })
    const res = createMockResponse()
    const next = createMockNext()

    ;(req as any)._validationError = {
      errors: { reason: 'Required' },
      httpPart: 'body',
    }
    res.statusCode = 400

    mw(req, res, next)
    expect(next).toHaveBeenCalled()

    // Trigger onFinish
    for (const fn of res._onFinish) {
      fn()
    }

    expect(loggedData).toBeDefined()
    expect(loggedData.statusCode).toBe(400)
    expect(loggedData.validation).toEqual({
      errors: { reason: 'Required' },
      httpPart: 'body',
    })
  })

  it('prints clean tabular diagnostic in dev mode with Field, Received, Expected', () => {
    const table = renderValidationTable([
      { field: 'phone', received: '"123"', expected: 'min: 7, max: 20' },
      {
        field: 'idProofs',
        received: '"[object Object]"',
        expected: 'Array of IDProof',
      },
    ])

    expect(table).toContain('Field')
    expect(table).toContain('Received')
    expect(table).toContain('Expected')
    expect(table).toContain('phone')
    expect(table).toContain('"123"')
    expect(table).toContain('min: 7, max: 20')
    expect(table).toContain('idProofs')
    expect(table).toContain('"[object Object]"')
    expect(table).toContain('Array of IDProof')
    expect(table).toContain('┌')
    expect(table).toContain('┼')
    expect(table).toContain('└')
  })

  it('validates nested array of objects without throwing Must be an array (stringified, single object)', () => {
    const schema = tex.object({
      idProofs: tex.array(
        tex.object({
          type: tex.string(),
          number: tex.string(),
        })
      ),
    })

    // 1. Standard array of objects
    const res1 = schema.parse({
      idProofs: [{ type: 'passport', number: 'A123' }],
    })
    expect(res1.idProofs.length).toBe(1)
    expect(res1.idProofs[0].type).toBe('passport')

    // 2. Coerces single object into array
    const res2 = schema.parse({
      idProofs: { type: 'license', number: 'B456' },
    })
    expect(res2.idProofs.length).toBe(1)
    expect(res2.idProofs[0].type).toBe('license')

    // 3. Auto-deserializes stringified JSON array
    const res3 = schema.parse({
      idProofs: '[{"type":"national_id","number":"C789"}]',
    })
    expect(res3.idProofs.length).toBe(1)
    expect(res3.idProofs[0].type).toBe('national_id')

    // 4. Plain object in tex.array({ ... }) without explicit tex.object
    const schemaPlain = tex.object({
      tags: tex.array({
        name: tex.string(),
      }),
    })
    const resPlain = schemaPlain.parse({
      tags: [{ name: 'typescript' }],
    })
    expect(resPlain.tags[0].name).toBe('typescript')
  })

  it('handles empty strings cleanly for optional, nullable, and nullish fields without failing type checks', () => {
    const schema = tex.object({
      phone: tex.string({ optional: true, min: 7 }),
      age: tex.number({ optional: true }),
      website: tex.string().optional(),
      bio: tex.string().nullable(),
      notes: tex.string().nullish(),
    })

    const res = schema.parse({
      phone: '',
      age: '',
      website: '',
      bio: '',
      notes: '',
    })

    expect(res.phone).toBeUndefined()
    expect(res.age).toBeUndefined()
    expect(res.website).toBeUndefined()
    expect(res.bio).toBeNull()
    expect(res.notes === undefined || res.notes === null).toBe(true)
  })
})
