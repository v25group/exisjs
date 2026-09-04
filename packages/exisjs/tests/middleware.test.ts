import {
  cors,
  helmet,
  requestId,
  notFound,
  validate,
} from '../src/middleware/middleware'
import { tex } from '../src/validator/tex'
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  getResponseBody,
  getResponseHeader,
} from './helpers'
import { describe, expect, it, ex, beforeAll, afterAll } from '../src/testing'
import { createTempDir, writeTempFile, cleanupTempDir } from './helpers'
import { serveStatic, requestLogger } from '../src/middleware/middleware'

// ─── CORS ─────────────────────────────────────────────────────────────────────

describe('cors()', () => {
  it('sets wildcard origin by default', () => {
    const handler = cors()
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    expect(getResponseHeader(res, 'access-control-allow-origin')).toBe('*')
    expect(next).toHaveBeenCalled()
  })

  it('sets specific string origin', () => {
    const handler = cors({ origin: 'https://example.com' })
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    expect(getResponseHeader(res, 'access-control-allow-origin')).toBe(
      'https://example.com'
    )
  })

  it('reflects origin from array when matching', () => {
    const handler = cors({
      origin: ['https://a.com', 'https://b.com'],
    })
    const req = createMockRequest({
      headers: { origin: 'https://b.com' },
    })
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    expect(getResponseHeader(res, 'access-control-allow-origin')).toBe(
      'https://b.com'
    )
  })

  it('does not set origin header when array does not match', () => {
    const handler = cors({
      origin: ['https://a.com'],
    })
    const req = createMockRequest({
      headers: { origin: 'https://evil.com' },
    })
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    expect(
      getResponseHeader(res, 'access-control-allow-origin')
    ).toBeUndefined()
  })

  it('supports regex origin', () => {
    const handler = cors({ origin: /\.example\.com$/ })
    const req = createMockRequest({
      headers: { origin: 'https://app.example.com' },
    })
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    expect(getResponseHeader(res, 'access-control-allow-origin')).toBe(
      'https://app.example.com'
    )
  })

  it('supports function origin', () => {
    const handler = cors({ origin: (o: string) => o.endsWith('.com') })
    const req = createMockRequest({
      headers: { origin: 'https://app.example.com' },
    })
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    expect(getResponseHeader(res, 'access-control-allow-origin')).toBe(
      'https://app.example.com'
    )
  })

  it('sets credentials header when enabled', () => {
    const handler = cors({ credentials: true })
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    expect(getResponseHeader(res, 'access-control-allow-credentials')).toBe(
      'true'
    )
  })

  it('sets exposed headers', () => {
    const handler = cors({ exposedHeaders: ['X-Total-Count', 'X-Page'] })
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    expect(getResponseHeader(res, 'access-control-expose-headers')).toBe(
      'X-Total-Count, X-Page'
    )
  })

  it('handles preflight OPTIONS request', () => {
    const handler = cors()
    const req = createMockRequest({ method: 'OPTIONS' })
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    expect(res.statusCode).toBe(204)
    expect(getResponseHeader(res, 'access-control-allow-methods')).toBeDefined()
    // Should NOT call next() — preflight is terminal
    expect(next).not.toHaveBeenCalled()
  })

  it('reflects request headers in preflight', () => {
    const handler = cors()
    const req = createMockRequest({
      method: 'OPTIONS',
      headers: { 'access-control-request-headers': 'X-Custom, Authorization' },
    })
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    expect(getResponseHeader(res, 'access-control-allow-headers')).toBe(
      'X-Custom, Authorization'
    )
  })
})

// ─── Helmet ───────────────────────────────────────────────────────────────────

describe('helmet()', () => {
  it('sets all security headers', () => {
    const handler = helmet()
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    expect(getResponseHeader(res, 'x-content-type-options')).toBe('nosniff')
    expect(getResponseHeader(res, 'x-frame-options')).toBe('DENY')
    expect(getResponseHeader(res, 'x-xss-protection')).toBe('1; mode=block')
    expect(getResponseHeader(res, 'referrer-policy')).toBe(
      'strict-origin-when-cross-origin'
    )
    expect(getResponseHeader(res, 'x-dns-prefetch-control')).toBe('off')
    expect(getResponseHeader(res, 'x-download-options')).toBe('noopen')
    expect(getResponseHeader(res, 'x-permitted-cross-domain-policies')).toBe(
      'none'
    )
    expect(getResponseHeader(res, 'strict-transport-security')).toBe(
      'max-age=31536000; includeSubDomains'
    )
    expect(getResponseHeader(res, 'permissions-policy')).toBe(
      'geolocation=(), microphone=(), camera=()'
    )
    expect(next).toHaveBeenCalled()
  })
})

// ─── Request ID ───────────────────────────────────────────────────────────────

describe('requestId()', () => {
  it('auto-generates a unique request ID', () => {
    const handler = requestId()
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    expect(req.requestId).toBeDefined()
    expect(typeof req.requestId).toBe('string')
    expect(req.requestId!.length).toBeGreaterThan(0)
    expect(getResponseHeader(res, 'x-request-id')).toBe(req.requestId)
    expect(next).toHaveBeenCalled()
  })

  it('preserves incoming X-Request-Id header', () => {
    const handler = requestId()
    const req = createMockRequest({
      headers: { 'x-request-id': 'incoming-123' },
    })
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    expect(req.requestId).toBe('incoming-123')
    expect(getResponseHeader(res, 'x-request-id')).toBe('incoming-123')
  })

  it('generates unique IDs for different requests', () => {
    const handler = requestId()
    const ids: string[] = []

    for (let i = 0; i < 10; i++) {
      const req = createMockRequest()
      const res = createMockResponse()
      handler(req, res, createMockNext())
      ids.push(req.requestId!)
    }

    const unique = new Set(ids)
    expect(unique.size).toBe(10) // all unique
  })
})

// ─── Not Found ────────────────────────────────────────────────────────────────

describe('notFound', () => {
  it('returns 404 with method and path', () => {
    const req = createMockRequest({ method: 'GET', url: '/api/unknown' })
    const res = createMockResponse()

    notFound(req, res, createMockNext())

    expect(res.statusCode).toBe(404)
    const body = getResponseBody(res) as never
    expect((body as any).success).toBe(false)
    expect((body as any).error.code).toBe('NOT_FOUND')
    expect((body as any).error.message).toContain('GET')
    expect((body as any).error.message).toContain('/api/unknown')
  })
})

// ─── Validate ─────────────────────────────────────────────────────────────────

describe('validate()', () => {
  it('passes through with valid body', async () => {
    const schema = { body: tex.object({ name: tex.string() }) }
    const handler = validate(schema)

    const req = createMockRequest()
    req.body = { name: 'John' }
    const res = createMockResponse()
    const next = createMockNext()

    await handler(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.body).toEqual({ name: 'John' })
  })

  it('returns 400 for invalid body', async () => {
    const schema = {
      body: tex.object({ name: tex.string(), email: tex.email() }),
    }
    const handler = validate(schema)

    const req = createMockRequest()
    req.body = { name: 123 }
    const res = createMockResponse()
    const next = createMockNext()

    await handler(req, res, next)

    expect(res.statusCode).toBe(400)
    const body = getResponseBody(res) as never
    expect((body as any).error.code).toBe('VALIDATION_ERROR')
    expect((body as any).error.details).toBeDefined()
    expect(next).not.toHaveBeenCalled()
  })

  it('validates query params', async () => {
    const schema = { query: tex.object({ page: tex.string() }) }
    const handler = validate(schema)

    const req = createMockRequest({ url: '/?page=1' })
    const res = createMockResponse()
    const next = createMockNext()

    await handler(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.query).toEqual({ page: '1' })
  })

  it('validates route params', async () => {
    const schema = { params: tex.object({ id: tex.string() }) }
    const handler = validate(schema)

    const req = createMockRequest()
    req.params = { id: '123' }
    const res = createMockResponse()
    const next = createMockNext()

    await handler(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.params).toEqual({ id: '123' })
  })
})

// ─── Request Logger ──────────────────────────────────────────────────────────

describe('requestLogger()', () => {
  it('logs requests on res.end()', () => {
    const mockLog = {
      info: ex.fn(),
      warn: ex.fn(),
      error: ex.fn(),
      child: ex.fn(() => mockLog),
    }
    const handler = requestLogger(mockLog as never)

    const req = createMockRequest({ method: 'GET', url: '/test' })
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)
    expect(next).toHaveBeenCalled()

    // Simulate response ending
    res.statusCode = 200
    res.end()

    expect(mockLog.info).toHaveBeenCalled()
  })

  it('logs warnings for 4xx errors', () => {
    const mockLog = {
      info: ex.fn(),
      warn: ex.fn(),
      error: ex.fn(),
      child: ex.fn(() => mockLog),
    }
    const handler = requestLogger(mockLog as never)
    const req = createMockRequest()
    const res = createMockResponse()
    handler(req, res, createMockNext())
    res.statusCode = 404
    res.end()
    expect(mockLog.warn).toHaveBeenCalled()
  })

  it('logs errors for 5xx errors', () => {
    const mockLog = {
      info: ex.fn(),
      warn: ex.fn(),
      error: ex.fn(),
      child: ex.fn(() => mockLog),
    }
    const handler = requestLogger(mockLog as never)
    const req = createMockRequest()
    const res = createMockResponse()
    handler(req, res, createMockNext())
    res.statusCode = 500
    res.end()
    expect(mockLog.error).toHaveBeenCalled()
  })
})

// ─── Serve Static ────────────────────────────────────────────────────────────

describe('serveStatic()', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = createTempDir('exis-serve-static-')
    writeTempFile(tmpDir, 'test.txt', 'hello world')
    writeTempFile(tmpDir, 'index.html', '<h1>Index</h1>')
  })

  afterAll(() => {
    cleanupTempDir(tmpDir)
  })

  it('serves a file', async () => {
    await new Promise<void>((resolve) => {
      const handler = serveStatic(tmpDir)
      const req = createMockRequest({ method: 'GET', url: '/test.txt' })
      const res = createMockResponse()

      res.sendStream = ex.fn((stream: any) => {
        expect(getResponseHeader(res, 'content-type')).toBe('text/plain')
        resolve()
        return res
      })

      handler(req, res, createMockNext())
    })
  })

  it('ignores POST requests', async () => {
    await new Promise<void>((resolve) => {
      const handler = serveStatic(tmpDir)
      const req = createMockRequest({ method: 'POST', url: '/test.txt' })
      const res = createMockResponse()

      handler(req, res, () => {
        resolve()
      })
    })
  })

  it('returns 404 or falls through for missing files', async () => {
    await new Promise<void>((resolve) => {
      const handler = serveStatic(tmpDir)
      const req = createMockRequest({ method: 'GET', url: '/missing.js' })
      const res = createMockResponse()

      handler(req, res, () => {
        resolve()
      })
    })
  })

  it('protects against path traversal', async () => {
    await new Promise<void>((resolve) => {
      const handler = serveStatic(tmpDir)
      const req = createMockRequest({
        method: 'GET',
        url: '/../../../../etc/passwd',
      })
      const res = createMockResponse()

      handler(req, res, () => {
        resolve()
      })
    })
  })

  it('handles HEAD requests', async () => {
    await new Promise<void>((resolve) => {
      const handler = serveStatic(tmpDir)
      const req = createMockRequest({ method: 'HEAD', url: '/test.txt' })
      const res = createMockResponse()

      res.send = ex.fn(() => {
        expect(res.statusCode).toBe(200)
        expect(getResponseHeader(res, 'content-type')).toBe('text/plain')
        resolve()
        return res
      })

      handler(req, res, createMockNext())
    })
  })
})

// ─── Native Validation Fallback ──────────────────────────────────────────────

describe('validate() fallback', () => {
  it('calls next(err) if parser throws non-ValidatorError', async () => {
    const fakeValidator = {
      parse: () => {
        throw new Error('Some catastrophic error')
      },
    }
    const schema = { body: fakeValidator as never }
    const handler = validate(schema)

    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    await handler(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(next.mock.calls[0].arguments[0]).toBeInstanceOf(Error)
  })
})
