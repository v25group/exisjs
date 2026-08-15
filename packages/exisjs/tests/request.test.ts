import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { Readable } from 'node:stream'
import { ExisRequest } from '../src/server/request'
import type { Request } from '../src/types'
import { createMockLogger, createMockResponse } from './helpers'
import qs from 'node:querystring'
import { describe, expect, it, ex, beforeAll, afterAll } from '../src/testing'

function buildRawRequest(options: {
  method?: string
  url?: string
  headers?: Record<string, string | string[]>
  remoteAddress?: string
}): IncomingMessage {
  const socket = new Socket()
  Object.defineProperty(socket, 'remoteAddress', {
    value: options.remoteAddress ?? '192.168.1.1',
    writable: true,
    configurable: true,
  })

  const raw = new IncomingMessage(socket)
  raw.method = options.method ?? 'GET'
  raw.url = options.url ?? '/'

  if (options.headers) {
    const h: Record<string, string | string[]> = {}
    for (const [k, v] of Object.entries(options.headers)) {
      h[k.toLowerCase()] = v
    }
    raw.headers = h as IncomingMessage['headers']
  }

  return raw
}

// ─── createRequest Wrapper ──────────────────────────────────────────────────────

function createRequest(
  raw: IncomingMessage,
  trustProxy?: boolean | number,
  bodyLimit?: number
): ExisRequest {
  const req = new ExisRequest(
    raw,
    createMockResponse() as any,
    trustProxy,
    bodyLimit
  )
  return req
}

async function parseBody(req: ExisRequest, limit?: number): Promise<void> {
  if (limit) {
    // Hacky way to test limit since it's private but we need it for tests
    ;(req as any).bodyLimit = limit
  }

  const method = req.method
  const contentType = req.get('content-type') ?? ''
  if (
    ['GET', 'HEAD', 'OPTIONS'].includes(method) ||
    contentType.includes('multipart/form-data')
  ) {
    return
  }

  await req.text()
  if (contentType.includes('application/json') && req.rawBody) {
    await req.json()
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    req.body = qs.parse(req.rawBody || '')
  } else {
    req.body = req.rawBody || undefined
  }
}

describe('createRequest()', () => {
  describe('path parsing', () => {
    it('strips query string from path', () => {
      const req = createRequest(buildRawRequest({ url: '/api/users?page=1' }))
      expect(req.path).toBe('/api/users')
    })

    it('handles URL without query string', () => {
      const req = createRequest(buildRawRequest({ url: '/api/users' }))
      expect(req.path).toBe('/api/users')
    })

    it('defaults to / for missing URL', () => {
      const raw = buildRawRequest({})
      raw.url = undefined
      const req = createRequest(raw)
      expect(req.path).toBe('/')
    })
  })

  describe('query parsing', () => {
    it('parses query parameters', () => {
      const req = createRequest(
        buildRawRequest({ url: '/api?page=1&limit=10' })
      )
      expect(req.query).toEqual({ page: '1', limit: '10' })
    })

    it('returns empty query for no query string', () => {
      const req = createRequest(buildRawRequest({ url: '/api' }))
      expect(req.query).toEqual({})
    })

    it('handles encoded query values', () => {
      const req = createRequest(
        buildRawRequest({ url: '/api?name=John%20Doe' })
      )
      expect(req.query.name).toBe('John Doe')
    })
  })

  describe('method normalization', () => {
    it('defaults to GET', () => {
      const raw = buildRawRequest({})
      raw.method = undefined
      const req = createRequest(raw)
      expect(req.method).toBe('GET')
    })
  })

  describe('cookie parsing', () => {
    it('parses simple cookies', () => {
      const req = createRequest(
        buildRawRequest({ headers: { cookie: 'session=abc; token=xyz' } })
      )
      expect(req.cookies).toEqual({ session: 'abc', token: 'xyz' })
    })

    it('decodes URL-encoded cookie values', () => {
      const req = createRequest(
        buildRawRequest({ headers: { cookie: 'name=John%20Doe' } })
      )
      expect(req.cookies.name).toBe('John Doe')
    })

    it('keeps first value for duplicate cookies', () => {
      const req = createRequest(
        buildRawRequest({ headers: { cookie: 'a=first; a=second' } })
      )
      expect(req.cookies.a).toBe('first')
    })

    it('handles no cookie header', () => {
      const req = createRequest(buildRawRequest({}))
      expect(req.cookies).toEqual({})
    })
  })

  describe('Proxy resolution (trustProxy)', () => {
    const defaultHeaders = {
      'x-forwarded-for': 'client, proxy1, proxy2',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'api.example.com',
      host: 'localhost:3000',
    }

    it('ignores proxy headers when trustProxy is false', () => {
      const req = createRequest(
        buildRawRequest({ headers: defaultHeaders }),
        false
      )
      expect(req.ips).toEqual([])
      expect(req.ip).toBe('192.168.1.1') // default mock remoteAddress
      expect(req.protocol).toBe('http')
      expect(req.secure).toBe(false)
      expect(req.hostname).toBe('localhost')
    })

    it('trusts all proxies when trustProxy is true', () => {
      const req = createRequest(
        buildRawRequest({ headers: defaultHeaders }),
        true
      )
      expect(req.ips).toEqual(['client', 'proxy1', 'proxy2'])
      expect(req.ip).toBe('client')
      expect(req.protocol).toBe('https')
      expect(req.secure).toBe(true)
      expect(req.hostname).toBe('api.example.com')
    })

    it('trusts up to N proxies when trustProxy is a number', () => {
      // trustProxy: 1 means we trust 1 proxy from the right (proxy2)
      // the client is then considered to be the next hop (proxy1)
      const req = createRequest(buildRawRequest({ headers: defaultHeaders }), 1)
      expect(req.ips).toEqual(['proxy1', 'proxy2'])
      expect(req.ip).toBe('proxy1')
    })

    it('trusts up to N proxies when trustProxy is 2', () => {
      const req = createRequest(buildRawRequest({ headers: defaultHeaders }), 2)
      expect(req.ips).toEqual(['client', 'proxy1', 'proxy2'])
      expect(req.ip).toBe('client')
    })

    it('handles proxy protocols gracefully', () => {
      const req = createRequest(
        buildRawRequest({ headers: { 'x-forwarded-proto': 'wss, https' } }),
        true
      )
      expect(req.protocol).toBe('wss')
      expect(req.secure).toBe(false)
    })
  })

  describe('req.get()', () => {
    it('returns header value (case-insensitive)', () => {
      const req = createRequest(
        buildRawRequest({ headers: { 'content-type': 'application/json' } })
      )
      expect(req.get('Content-Type')).toBe('application/json')
      expect(req.get('content-type')).toBe('application/json')
    })

    it('returns first element for array headers', () => {
      const req = createRequest(
        buildRawRequest({
          headers: { 'x-custom': ['first', 'second'] },
        })
      )
      expect(req.get('x-custom')).toBe('first')
    })

    it('returns undefined for missing header', () => {
      const req = createRequest(buildRawRequest({}))
      expect(req.get('x-nonexistent')).toBeUndefined()
    })
  })

  describe('req.is()', () => {
    it('matches content type', () => {
      const req = createRequest(
        buildRawRequest({
          headers: { 'content-type': 'application/json; charset=utf-8' },
        })
      )
      expect(req.is('application/json')).toBe(true)
      expect(req.is('text/html')).toBe(false)
    })

    it('returns false when no content-type', () => {
      const req = createRequest(buildRawRequest({}))
      expect(req.is('application/json')).toBe(false)
    })
  })

  describe('initializes empty state', () => {
    it('has undefined params', () => {
      const req = createRequest(buildRawRequest({}))
      expect(req.params).toBeUndefined()
    })

    it('has undefined body', () => {
      const req = createRequest(buildRawRequest({}))
      expect(req.body).toBeUndefined()
    })

    it('has undefined rawBody', () => {
      const req = createRequest(buildRawRequest({}))
      expect(req.rawBody).toBeUndefined()
    })
  })
})

// ─── parseBody ────────────────────────────────────────────────────────────────

describe('parseBody()', () => {
  function createReadableRequest(options: {
    method?: string
    headers?: Record<string, string>
    body?: string
    remoteAddress?: string
  }): Request {
    const socket = new Socket()
    Object.defineProperty(socket, 'remoteAddress', {
      value: options.remoteAddress ?? '127.0.0.1',
      writable: true,
      configurable: true,
    })

    // Create a readable stream that emits the body
    const readable = new Readable({
      read() {
        if (options.body) {
          this.push(Buffer.from(options.body))
        }
        this.push(null) // EOF
      },
    })

    // Mix IncomingMessage properties onto the readable
    Object.assign(readable, {
      method: options.method ?? 'POST',
      url: '/',
      headers: options.headers ?? {},
      socket,
    })

    const req = createRequest(readable as unknown as IncomingMessage)
    req.log = createMockLogger()
    return req
  }

  describe('formData()', () => {
    it('parses urlencoded form data', async () => {
      const req = createReadableRequest({
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'name=John&age=30',
      })
      const { fields, files } = await (req as any).formData()
      expect(fields).toEqual({ name: 'John', age: '30' })
      expect(files).toEqual({})
    })

    it('parses multipart/form-data', async () => {
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
      const body = `--${boundary}\r
Content-Disposition: form-data; name="user"\r
\r
John\r
--${boundary}\r
Content-Disposition: form-data; name="profilePic"; filename="test.jpg"\r
Content-Type: image/jpeg\r
\r
filecontent\r
--${boundary}--\r
`
      const req = createReadableRequest({
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      })

      const { fields, files } = await (req as any).formData()
      expect(fields).toEqual({ user: 'John' })
      expect((req as any).files.length).toBe(1)
      expect((req as any).files[0].fieldname).toBe('profilePic')
      expect((req as any).files[0].filename).toBe('test.jpg')
      expect((req as any).files[0].mimetype).toBe('image/jpeg')
      expect((req as any).files[0].data.toString()).toBe('filecontent')
      expect(typeof (req as any).files[0].saveToDisk).toBe('function')
    })
  })

  it('parses JSON body', async () => {
    const req = createReadableRequest({
      headers: { 'content-type': 'application/json' },
      body: '{"name":"John","age":30}',
    })

    await parseBody(req)

    expect(req.body).toEqual({ name: 'John', age: 30 })
    expect(req.rawBody).toBe('{"name":"John","age":30}')
  })

  it('parses URL-encoded body', async () => {
    const req = createReadableRequest({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'name=John&age=30',
    })

    await parseBody(req)

    expect(req.body).toEqual({ name: 'John', age: '30' })
  })

  it('stores raw text for other content types', async () => {
    const req = createReadableRequest({
      headers: { 'content-type': 'text/plain' },
      body: 'Hello World',
    })

    await parseBody(req)

    expect(req.body).toBe('Hello World')
  })

  it('skips body for GET requests', async () => {
    const req = createReadableRequest({ method: 'GET' })
    await parseBody(req)
    expect(req.body).toBeUndefined()
  })

  it('skips body for HEAD requests', async () => {
    const req = createReadableRequest({ method: 'HEAD' })
    await parseBody(req)
    expect(req.body).toBeUndefined()
  })

  it('skips body for OPTIONS requests', async () => {
    const req = createReadableRequest({ method: 'OPTIONS' })
    await parseBody(req)
    expect(req.body).toBeUndefined()
  })

  it('skips multipart/form-data', async () => {
    const req = createReadableRequest({
      headers: { 'content-type': 'multipart/form-data; boundary=abc' },
    })

    await parseBody(req)
    expect(req.body).toBeUndefined()
  })

  it('rejects when body exceeds limit', async () => {
    const largeBody = 'x'.repeat(200)
    const req = createReadableRequest({
      headers: { 'content-type': 'text/plain' },
      body: largeBody,
    })

    await expect(parseBody(req, 100)).rejects.toThrow('exceeds limit')
  })

  it('rejects on invalid JSON', async () => {
    const req = createReadableRequest({
      headers: { 'content-type': 'application/json' },
      body: '{invalid json}',
    })

    await expect(parseBody(req)).rejects.toThrow('Invalid JSON body')
  })

  it('handles empty body', async () => {
    const req = createReadableRequest({
      headers: { 'content-type': 'application/json' },
      body: '',
    })

    await parseBody(req)
    expect(req.body).toBeUndefined()
  })
})

describe('Request ID Generation', () => {
  it('generates a new requestId if not provided', () => {
    const raw = buildRawRequest({ headers: {} })
    const res = createMockResponse()
    const req = new ExisRequest(raw, res).init(raw, res)

    expect(req.requestId).toBeDefined()
    expect(typeof req.requestId).toBe('string')
    expect(req.requestId?.length).toBeGreaterThan(10)
    expect(res.getHeader('X-Request-Id')).toBe(req.requestId)
  })

  it('uses provided x-request-id header', () => {
    const raw = buildRawRequest({
      headers: { 'x-request-id': 'custom-id-123' },
    })
    const res = createMockResponse()
    const req = new ExisRequest(raw, res).init(raw, res)

    expect(req.requestId).toBe('custom-id-123')
    expect(res.getHeader('X-Request-Id')).toBe('custom-id-123')
  })
})

describe('URL Path Normalization', () => {
  it('collapses multiple slashes', () => {
    const raw = buildRawRequest({ url: '//api///v1//users//' })
    const res = createMockResponse()
    const req = new ExisRequest(raw, res).init(raw, res)

    expect(req.path).toBe('/api/v1/users/')
  })

  it('does not affect query parameters', () => {
    const raw = buildRawRequest({ url: '//api//v1//search?query=//test//' })
    const res = createMockResponse()
    const req = new ExisRequest(raw, res).init(raw, res)

    expect(req.path).toBe('/api/v1/search')
    expect(req.query).toEqual({ query: '//test//' })
  })
})
