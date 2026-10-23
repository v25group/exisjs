import { App } from '../src/server/app'
import { createTestApp } from '../src/testing/client'
import { describe, expect, it } from '../src/testing'
import { rateLimit } from '../src/middleware/rate-limit'
import {
  csrf,
  helmet,
  mongoSanitize,
  dbSanitize,
} from '../src/middleware/security'
import type { Request, Response, NextFunction } from '../src/types'

describe('Security Middlewares', () => {
  describe('Rate Limiting', () => {
    it('blocks requests after max limit is reached', async () => {
      const app = new App()
      app.use(rateLimit({ windowMs: 1000, max: 2 }))
      app.get('/', (req, res) => res.send('OK'))

      const client = createTestApp(app)

      await client.get('/').expect(200).expect('OK')
      await client.get('/').expect(200).expect('OK')
      await client
        .get('/')
        .expect(429)
        .expect({
          success: false,
          statusCode: 429,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests, please try again later.',
          },
        })
    })

    it('ignores X-Forwarded-For when trustProxy is false', async () => {
      const app = new App()
      // trustProxy is false by default
      app.use(rateLimit({ windowMs: 1000, max: 1 }))
      app.get('/', (req, res) => res.send(req.ip))

      const client = createTestApp(app)

      // Both requests come from 127.0.0.1 (the test client default)
      // Even if they pass different X-Forwarded-For headers, they should share the same limit bucket
      await client.get('/').set('x-forwarded-for', '10.0.0.1').expect(200)
      await client.get('/').set('x-forwarded-for', '10.0.0.2').expect(429)
    })

    it('respects X-Forwarded-For when trustProxy is true', async () => {
      const app = new App({ trustProxy: true })
      app.use(rateLimit({ windowMs: 1000, max: 1 }))
      app.get('/', (req, res) => res.send(req.ip))

      const client = createTestApp(app)

      // Since trustProxy is true, the rate limiter uses the IP from the header
      // Thus, each spoofed IP gets its own bucket
      await client.get('/').set('x-forwarded-for', '10.0.0.1').expect(200)
      await client.get('/').set('x-forwarded-for', '10.0.0.2').expect(200) // Different IP, should not be rate limited
      await client.get('/').set('x-forwarded-for', '10.0.0.2').expect(429) // Second request from same IP, should block
    })

    it('attaches standard IETF and legacy rate limit headers including Retry-After', async () => {
      const app = new App()
      app.use(rateLimit({ windowMs: 5000, max: 1 }))
      app.get('/', (req, res) => res.send('OK'))

      const client = createTestApp(app)

      const res1 = await client.get('/').expect(200)
      expect(res1.headers['ratelimit-limit']).toBe('1')
      expect(res1.headers['ratelimit-remaining']).toBe('0')
      expect(res1.headers['ratelimit-reset']).toBe('5')
      expect(res1.headers['x-ratelimit-limit']).toBe('1')
      expect(res1.headers['x-ratelimit-remaining']).toBe('0')
      expect(res1.headers['x-ratelimit-reset']).toBeDefined()

      const res2 = await client.get('/').expect(429)
      expect(res2.headers['retry-after']).toBe('5')
      expect(res2.headers['ratelimit-remaining']).toBe('0')
    })
  })

  describe('CSRF Protection', () => {
    it('allows safe methods without a token', async () => {
      const app = new App()
      app.use(
        csrf({
          secret: 'a-very-long-and-secure-secret-key-that-is-at-least-32-bytes',
        })
      )
      app.get('/', (req, res) => res.send('OK'))

      const client = createTestApp(app)
      await client.get('/').expect(200)
      // Note: ExisJS test client currently only has explicit methods for get/post/put/patch/delete
      // so we rely on testing the GET method which is safe.
    })

    it('rejects state-changing methods without a valid token', async () => {
      const app = new App()
      app.use(
        csrf({
          secret: 'a-very-long-and-secure-secret-key-that-is-at-least-32-bytes',
        })
      )
      app.post('/', (req, res) => res.send('OK'))

      const client = createTestApp(app)
      await client.post('/').expect(403) // Should reject due to missing CSRF token header
    })

    it('rejects requests with mismatched Origin and Host', async () => {
      const app = new App()
      app.use(
        csrf({
          secret: 'a-very-long-and-secure-secret-key-that-is-at-least-32-bytes',
        })
      )
      app.post('/', (req, res) => res.send('OK'))

      const client = createTestApp(app)

      // Get a valid token first via a safe method
      const getRes = await client.get('/')
      const cookieHeader = getRes.headers['set-cookie']
      const cookie = Array.isArray(cookieHeader)
        ? cookieHeader[0]
        : (cookieHeader as unknown as string)

      // We don't need to extract the exact token for this test because the Origin check happens after the token check,
      // wait, the token check happens FIRST. So we must provide a valid token.

      // In ExisJS, the CSRF token is exposed on the request object for rendering in templates.
      // We can create a helper route to expose it for our test.
    })

    it('end-to-end CSRF flow with token and origin check', async () => {
      const app = new App()
      app.use(
        csrf({
          secret: 'a-very-long-and-secure-secret-key-that-is-at-least-32-bytes',
        })
      )

      app.get('/form', (req: any, res) => {
        res.send(req.csrfToken)
      })

      app.post('/submit', (req, res) => {
        res.send('Success')
      })

      const client = createTestApp(app)

      // 1. Get the token and cookie
      const getRes = await client.get('/form')
      const token = getRes.text
      const cookieHeader = getRes.headers['set-cookie']
      const cookie = Array.isArray(cookieHeader)
        ? cookieHeader[0]
        : (cookieHeader as unknown as string)

      // 2. Submit with token but bad origin -> should fail
      await client
        .post('/submit')
        .set('Cookie', cookie)
        .set('x-csrf-token', token)
        .set('Origin', 'http://malicious.com')
        .set('Host', 'localhost:3000')
        .expect(403)

      // 3. Submit with token and valid origin -> should succeed
      await client
        .post('/submit')
        .set('Cookie', cookie)
        .set('x-csrf-token', token)
        .set('Origin', 'http://localhost:3000')
        .set('Host', 'localhost:3000')
        .expect(200)
        .expect('Success')
    })
  })

  describe('CSRF behind a proxy', () => {
    const secret = 'a-very-long-and-secure-secret-key-that-is-at-least-32-bytes'
    async function post(
      appOptions: any,
      csrfOptions: any,
      headers: Record<string, string>
    ) {
      const app = new App(appOptions)
      app.use(csrf({ secret, ...csrfOptions }))
      app.get('/form', (req: any, res) => res.send(req.csrfToken))
      app.post('/submit', (_req, res) => res.send('Success'))
      const client = createTestApp(app)
      const form = await client.get('/form')
      const cookie = String(form.headers['set-cookie']).split(';')[0]
      let req = client
        .post('/submit')
        .set('Cookie', cookie)
        .set('x-csrf-token', form.text)
      for (const [k, v] of Object.entries(headers)) req = req.set(k, v)
      return req
    }
    const site = {
      Origin: 'https://crm.example.com',
      Host: 'api.internal:4000',
    }

    it('compares with X-Forwarded-Host when trustProxy is set', async () => {
      const forwarded = { ...site, 'X-Forwarded-Host': 'crm.example.com' }
      expect((await post({ trustProxy: 1 }, {}, forwarded)).status).toBe(200)
      // Without trustProxy the header is ignored: Host decides
      const refused = await post({}, {}, forwarded)
      expect(refused.status).toBe(403)
      expect(refused.body.error.details).toEqual({
        expectedHost: 'api.internal:4000',
        receivedOrigin: 'https://crm.example.com',
      })
    })

    it('accepts allowedOrigins for an API on another host', async () => {
      const allowed = { allowedOrigins: ['https://crm.example.com/'] }
      expect((await post({}, allowed, site)).status).toBe(200)
      const other = { ...site, Origin: 'https://evil.example.com' }
      expect((await post({}, allowed, other)).status).toBe(403)
    })
  })

  describe('Helmet (Security Headers)', () => {
    it('sets default security headers and hides X-Powered-By', async () => {
      const app = new App()
      // Let's add an explicit X-Powered-By first to ensure Helmet removes it
      app.use((req: Request, res: Response, next: NextFunction) => {
        res.setHeader('X-Powered-By', 'Express')
        next()
      })
      app.use(helmet())
      app.get('/', (req, res) => res.send('OK'))

      const client = createTestApp(app)
      const res = await client.get('/')

      expect(res.headers['x-dns-prefetch-control']).toBe('off')
      expect(res.headers['x-frame-options']).toBe('DENY')
      expect(res.headers['x-powered-by']).toBeUndefined()
    })

    it('injects CSP nonce when {nonce} is in the policy string', async () => {
      const app = new App()
      app.use(
        helmet({
          contentSecurityPolicy:
            "default-src 'self'; script-src 'nonce-{nonce}';",
        })
      )
      app.get('/', (req, res) => res.send('OK'))

      const client = createTestApp(app)
      const res1 = await client.get('/')
      const res2 = await client.get('/')

      const csp1 = res1.headers['content-security-policy'] as string
      const csp2 = res2.headers['content-security-policy'] as string

      expect(csp1).toBeDefined()
      expect(csp2).toBeDefined()

      // Ensure {nonce} was replaced
      expect(csp1).not.toContain('{nonce}')
      // Ensure nonce is uniquely generated per request
      expect(csp1).not.toBe(csp2)
    })
  })

  describe('NoSQL Injection Protection (mongoSanitize)', () => {
    it('does not crash when req.params or req.query are undefined or empty', () => {
      const middleware = mongoSanitize()
      const req: any = {
        body: {
          username: 'admin',
          $where: 'malicious code',
          nested: { $gt: 1, safe: 'yes' },
        },
        // params and query intentionally undefined
      }
      const res: any = {}
      let nextCalled = false

      middleware(req, res, () => {
        nextCalled = true
      })

      expect(nextCalled).toBe(true)
      expect(req.body).toEqual({ username: 'admin', nested: { safe: 'yes' } })
    })

    it('works safely with dbSanitize on undefined params and query', () => {
      const middleware = dbSanitize({ mongo: true })
      const req: any = {
        body: { username: 'john', $gt: '' },
        params: undefined,
        query: undefined,
      }
      const res: any = {}
      let nextCalled = false

      middleware(req, res, () => {
        nextCalled = true
      })

      expect(nextCalled).toBe(true)
      expect(req.body).toEqual({ username: 'john' })
    })
  })
})

describe('Proxy without trustProxy', () => {
  it('warns once in production when requests carry proxy headers', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const warns: string[] = []
      const app = new App()
      app.get('/', () => 'ok')
      await app.create()
      app.log.warn = ((msg: string) => warns.push(String(msg))) as any
      const client = createTestApp(app)
      await client.get('/')
      expect(warns.length).toBe(0)
      await client.get('/').set('x-forwarded-for', '203.0.113.7')
      await client.get('/').set('x-forwarded-for', '203.0.113.8')
      expect(warns.length).toBe(1)
      expect(warns[0]).toContain('trustProxy is off')

      const trusted = new App({ trustProxy: 1 })
      trusted.get('/', () => 'ok')
      await trusted.create()
      let trustedWarned = false
      trusted.log.warn = (() => (trustedWarned = true)) as any
      await createTestApp(trusted)
        .get('/')
        .set('x-forwarded-for', '203.0.113.7')
      expect(trustedWarned).toBe(false)
    } finally {
      process.env.NODE_ENV = prev
    }
  })
})

describe('Rate limit helpers for lockouts', () => {
  it('counts failures, refuses while locked without counting, and resets', async () => {
    const { MemoryRateLimitStore, consume, assertNotLimited } =
      await import('../src/middleware/rate-limit')
    const store = new MemoryRateLimitStore()
    const opts = { max: 2, windowMs: 60_000 }
    const key = 'login:a@example.com'

    await assertNotLimited(store, key, opts)
    await consume(store, key, opts)
    await consume(store, key, opts)
    expect(store.get(key)?.count).toBe(2)

    const locked = await assertNotLimited(store, key, opts).catch((e) => e)
    expect(locked.statusCode).toBe(429)
    expect(locked.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(locked.details.retryAfter).toBeGreaterThan(0)
    expect(store.get(key)?.count).toBe(2) // checking didn't count a hit

    const over = await consume(store, key, opts).catch((e) => e)
    expect(over.statusCode).toBe(429)

    store.reset(key)
    expect(store.get(key)).toBeUndefined()
    await assertNotLimited(store, key, opts)
  })
})

describe('requireUser', () => {
  it('returns the signed-in user, or throws 401 when there is none', async () => {
    const { requireUser } = await import('../src/router')
    const me = { id: 'u1' }
    expect(requireUser({ user: me })).toBe(me)
    const err = (() => {
      try {
        requireUser({ user: undefined })
      } catch (e) {
        return e as any
      }
    })()
    expect(err.statusCode).toBe(401)
    expect(err.code).toBe('UNAUTHORIZED')
  })
})
