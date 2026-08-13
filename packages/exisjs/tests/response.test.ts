import { Readable } from 'node:stream'
import {
  createMockResponse,
  getResponseBody,
  getResponseHeader,
} from './helpers'
import { describe, expect, it } from '../src/testing'
// ─── res.status() ─────────────────────────────────────────────────────────────

describe('res.status()', () => {
  it('sets status code', () => {
    const res = createMockResponse()
    res.status(201)
    expect(res.statusCode).toBe(201)
  })

  it('returns this for chaining', () => {
    const res = createMockResponse()
    expect(res.status(200)).toBe(res)
  })
})

// ─── res.json() ───────────────────────────────────────────────────────────────

describe('res.json()', () => {
  it('serializes data as JSON', () => {
    const res = createMockResponse()
    res.json({ name: 'John', age: 30 })

    expect(getResponseBody(res)).toEqual({ name: 'John', age: 30 })
  })

  it('sets Content-Type to application/json', () => {
    const res = createMockResponse()
    res.json({ ok: true })

    expect(getResponseHeader(res, 'content-type')).toBe(
      'application/json; charset=utf-8'
    )
  })

  it('no-ops when headers already sent', () => {
    const res = createMockResponse()
    res.json({ first: true })
    const bodyBefore = res._body

    res.json({ second: true })
    expect(res._body).toBe(bodyBefore) // unchanged
  })

  it('handles serialization failure', () => {
    const res = createMockResponse()

    // Create a circular reference that JSON.stringify can't handle
    const circular: Record<string, unknown> = {}
    circular.self = circular

    res.json(circular)

    expect(res.statusCode).toBe(500)
    const body = getResponseBody(res) as never
    expect((body as any).error).toBe('Failed to serialize response')
  })
})

// ─── res.html() ───────────────────────────────────────────────────────────────

describe('res.html()', () => {
  it('sends HTML content', () => {
    const res = createMockResponse()
    res.html('<h1>Hello</h1>')

    expect(res._body).toBe('<h1>Hello</h1>')
    expect(getResponseHeader(res, 'content-type')).toBe(
      'text/html; charset=utf-8'
    )
  })

  it('no-ops when headers already sent', () => {
    const res = createMockResponse()
    res.html('<p>first</p>')
    const bodyBefore = res._body
    res.html('<p>second</p>')
    expect(res._body).toBe(bodyBefore)
  })
})

// ─── res.send() ───────────────────────────────────────────────────────────────

describe('res.send()', () => {
  it('sends string with text/plain', () => {
    const res = createMockResponse()
    res.send('Hello World')

    expect(res._body).toBe('Hello World')
    expect(getResponseHeader(res, 'content-type')).toBe(
      'text/plain; charset=utf-8'
    )
  })

  it('sends Buffer with application/octet-stream', () => {
    const res = createMockResponse()
    const buf = Buffer.from('binary data')
    res.send(buf)

    expect(getResponseHeader(res, 'content-type')).toBe(
      'application/octet-stream'
    )
  })

  it('preserves custom Content-Type', () => {
    const res = createMockResponse()
    res.set('Content-Type', 'text/csv')
    res.send('a,b,c')

    expect(getResponseHeader(res, 'content-type')).toBe('text/csv')
  })

  it('no-ops when headers already sent', () => {
    const res = createMockResponse()
    res.send('first')
    const bodyBefore = res._body
    res.send('second')
    expect(res._body).toBe(bodyBefore)
  })
})

// ─── res.redirect() ──────────────────────────────────────────────────────────

describe('res.redirect()', () => {
  it('sets Location header and 302 status', () => {
    const res = createMockResponse()
    res.redirect('/login')

    expect(res.statusCode).toBe(302)
    expect(getResponseHeader(res, 'location')).toBe('/login')
  })

  it('supports custom redirect code', () => {
    const res = createMockResponse()
    res.redirect('/permanent', 301)
    expect(res.statusCode).toBe(301)
  })

  it('no-ops when headers already sent', () => {
    const res = createMockResponse()
    res.send('ok')
    res.redirect('/nope')
    // statusCode shouldn't change to 302
    expect(res.statusCode).toBe(200)
  })
})

// ─── res.set() / res.setStrHeaders() ─────────────────────────────────────────

describe('res.set() / res.setStrHeaders()', () => {
  it('sets a single header', () => {
    const res = createMockResponse()
    const result = res.set('X-Custom', 'value')

    expect(getResponseHeader(res, 'x-custom')).toBe('value')
    expect(result).toBe(res) // chaining
  })

  it('sets multiple headers', () => {
    const res = createMockResponse()
    const result = res.setStrHeaders({
      'X-One': '1',
      'X-Two': '2',
    })

    expect(getResponseHeader(res, 'x-one')).toBe('1')
    expect(getResponseHeader(res, 'x-two')).toBe('2')
    expect(result).toBe(res) // chaining
  })
})

// ─── res.cookie() / res.clearCookie() ────────────────────────────────────────

describe('res.cookie()', () => {
  it('sets a basic cookie', () => {
    const res = createMockResponse()
    res.cookie('session', 'abc123')

    const header = res.getHeader('Set-Cookie') as string
    expect(header).toContain('session=abc123')
    expect(header).toContain('Path=/')
  })

  it('encodes cookie name and value', () => {
    const res = createMockResponse()
    res.cookie('user name', 'John Doe')

    const header = res.getHeader('Set-Cookie') as string
    expect(header).toContain('user%20name=John%20Doe')
  })

  it('sets all cookie options', () => {
    const res = createMockResponse()
    const expires = new Date('2030-01-01')
    res.cookie('token', 'jwt', {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 3600,
      expires,
      path: '/api',
      domain: '.example.com',
    })

    const header = res.getHeader('Set-Cookie') as string
    expect(header).toContain('HttpOnly')
    expect(header).toContain('Secure')
    expect(header).toContain('SameSite=Strict')
    expect(header).toContain('Max-Age=3600')
    expect(header).toContain('Path=/api')
    expect(header).toContain('Domain=.example.com')
    expect(header).toContain('Expires=')
  })

  it('appends multiple cookies', () => {
    const res = createMockResponse()
    res.cookie('a', '1')
    res.cookie('b', '2')

    const header = res.getHeader('Set-Cookie')
    expect(Array.isArray(header)).toBe(true)
    expect(header).toHaveLength(2)
  })

  it('returns this for chaining', () => {
    const res = createMockResponse()
    expect(res.cookie('a', '1')).toBe(res)
  })
})

describe('res.clearCookie()', () => {
  it('sets expired cookie', () => {
    const res = createMockResponse()
    res.clearCookie('session')

    const header = res.getHeader('Set-Cookie') as string
    expect(header).toContain('session=')
    expect(header).toContain('Expires=Thu, 01 Jan 1970')
    expect(header).toContain('HttpOnly')
  })

  it('returns this for chaining', () => {
    const res = createMockResponse()
    expect(res.clearCookie('a')).toBe(res)
  })
})

// ─── res.sendStream() ─────────────────────────────────────────────────────────────

describe('res.sendStream()', () => {
  it('sets default Content-Type for streams', () => {
    const res = createMockResponse()
    const readable = new Readable({
      read() {
        this.push(null)
      },
    })

    res.sendStream(readable)

    expect(getResponseHeader(res, 'content-type')).toBe(
      'application/octet-stream'
    )
  })

  it('preserves custom Content-Type', () => {
    const res = createMockResponse()
    res.set('Content-Type', 'text/event-stream')

    const readable = new Readable({
      read() {
        this.push(null)
      },
    })

    res.sendStream(readable)

    // Should keep custom type, not override
    expect(res.getHeader('Content-Type')).toBe('text/event-stream')
  })
})
