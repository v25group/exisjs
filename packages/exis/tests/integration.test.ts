import { App } from '../src/server/app'
import { Router } from '../src/router/router'
import { HttpError, asyncHandler } from '../src/utils/errors'
import { createTestApp, TestApp } from '../src/testing/client'
import { describe, expect, it, ex, beforeAll, afterAll } from '../src/testing'
// ─── Integration Tests ───────────────────────────────────────────────────────

describe('Integration: Full Request Lifecycle', () => {
  let app: App
  let testApp: TestApp

  beforeAll(() => {
    app = new App({
      logger: false,
      cors: false,

      helmet: false,
    })

    // Register routes directly on app
    app.get('/api/users', (_req, res) => {
      res.json({ success: true, data: [{ id: 1, name: 'John' }] })
    })
    app.get('/api/users/:id', (req, res) => {
      res.json({ success: true, data: { id: req.params.id } })
    })
    app.post('/api/users', async (req, res) => {
      const body = await req.json()
      res.status(201).json({ success: true, data: body })
    })

    // New Advanced Methods
    app.query('/api/search', async (req, res) => {
      const body = await req.json()
      res.json({ success: true, method: 'QUERY', query: body })
    })
    app.trace('/api/trace', (req, res) => {
      res.json({ success: true, method: 'TRACE' })
    })
    app.connect('/api/connect', (req, res) => {
      res.json({ success: true, method: 'CONNECT' })
    })

    // Error route
    app.get('/error', () => {
      throw HttpError.badRequest('Test error', { detail: 'test' })
    })

    // Async error route
    app.get(
      '/async-error',
      asyncHandler(async () => {
        throw HttpError.notFound('Item')
      })
    )

    testApp = createTestApp(app)
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /api/users returns user list', async () => {
    const res = await testApp.get('/api/users').expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].name).toBe('John')
  })

  it('POST /api/users should create user', async () => {
    const res = await testApp.post('/api/users').send({ name: 'Jane' })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.name).toBe('Jane')
  })

  it('QUERY /api/search should return with body', async () => {
    // Supertest doesn't natively expose `.query()`, so we use `.request` or just cast to any
    const res = await (testApp as any)
      .query('/api/search')
      .send({ filter: 'test' })

    expect(res.status).toBe(200)
    expect(res.body.method).toBe('QUERY')
    expect(res.body.query.filter).toBe('test')
  })

  it('TRACE /api/trace should match route', async () => {
    // Node.js fetch (used by inject) forbids TRACE method, so we test it directly via http module
    const server = require('http').createServer(app.handle.bind(app))
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const port = (server.address() as any).port

    const res = await new Promise<any>((resolve, reject) => {
      const req = require('http').request(
        `http://localhost:${port}/api/trace`,
        { method: 'TRACE' },
        (response: any) => {
          let data = ''
          response.on('data', (chunk: any) => (data += chunk))
          response.on('end', () =>
            resolve({ status: response.statusCode, body: JSON.parse(data) })
          )
        }
      )
      req.on('error', reject)
      req.end()
    })

    server.close()

    expect(res.status).toBe(200)
    expect(res.body.method).toBe('TRACE')
  })

  it('GET /api/users/:id extracts params', async () => {
    const res = await testApp.get('/api/users/42').expect(200)

    expect(res.body.data.id).toBe('42')
  })

  it('POST /api/users with JSON body', async () => {
    const res = await testApp
      .post('/api/users')
      .send({ name: 'Jane', email: 'jane@example.com' })
      .expect(201)

    expect(res.body.data).toEqual({
      name: 'Jane',
      email: 'jane@example.com',
    })
  })

  it('returns 404 for unregistered routes', async () => {
    const res = await testApp.get('/api/unknown').expect(404)

    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('handles thrown HttpError correctly', async () => {
    const res = await testApp.get('/error').expect(400)

    expect(res.body.error.code).toBe('BAD_REQUEST')
    expect(res.body.error.message).toBe('Test error')
    expect(res.body.error.details).toEqual({ detail: 'test' })
  })

  it('handles async errors via asyncHandler', async () => {
    const res = await testApp.get('/async-error').expect(404)

    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(res.body.error.message).toBe('Item not found')
  })

  it('sets X-Request-Id header', async () => {
    const res = await testApp.get('/api/users').expect(200)

    expect(res.headers['x-request-id']).toBeDefined()
    expect(typeof res.headers['x-request-id']).toBe('string')
  })

  it('preserves incoming X-Request-Id', async () => {
    const res = await testApp
      .get('/api/users')
      .set('X-Request-Id', 'custom-id-123')
      .expect(200)

    expect(res.headers['x-request-id']).toBe('custom-id-123')
  })
})

// ─── Integration: Middleware Execution ───────────────────────────────────────

describe('Integration: Middleware & Config', () => {
  it('disabling features via config works', async () => {
    const testApp = new App({
      cors: false,
      helmet: false,

      logger: false,
    })

    testApp.get('/test', (_req, res) => {
      res.json({ ok: true })
    })

    const request = createTestApp(testApp)

    const res = await request.get('/test').expect(200)

    // CORS headers should NOT be present
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    // Helmet headers should NOT be present
    expect(res.headers['x-frame-options']).toBeUndefined()
  })

  it('app.mount() applies prefix correctly', async () => {
    const testApp = new App({
      cors: false,
      helmet: false,

      logger: false,
    })

    const router = new Router()
    router.get('/items', (_req, res) => {
      res.json({ items: [] })
    })

    testApp.mount('/api/v2', router)

    const request = createTestApp(testApp)

    const res = await request.get('/api/v2/items').expect(200)
    expect(res.body.items).toEqual([])

    // Wrong prefix should 404
    await request.get('/api/v1/items').expect(404)
  })
})
