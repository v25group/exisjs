import { timeout } from '../src/middleware/middleware'
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  getResponseBody,
} from './helpers'
import { describe, expect, it } from '../src/testing'

describe('timeout() middleware', () => {
  it('calls next() and attaches setTimeout and clearTimeout to req', () => {
    const handler = timeout()
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(typeof (req as any).setTimeout).toBe('function')
    expect(typeof (req as any).clearTimeout).toBe('function')
  })

  it('triggers 503 Service Unavailable when timeout expires', async () => {
    const handler = timeout(50)
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)
    expect(res.headersSent).toBe(false)

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(res.statusCode).toBe(503)
    const body = getResponseBody<any>(res)
    expect(body.error?.code).toBe('TIMEOUT')
  })

  it('allows customizing status code and message', async () => {
    const handler = timeout({
      ms: 40,
      statusCode: 504,
      message: 'Gateway Timeout connecting to upstream cloud service',
    })
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(res.statusCode).toBe(504)
    const body = getResponseBody<any>(res)
    expect(body.error?.message).toBe(
      'Gateway Timeout connecting to upstream cloud service'
    )
  })

  it('skips timeout when route is in exclude array', async () => {
    const handler = timeout({
      ms: 40,
      exclude: ['/upload', '/ai/generate', /^\/export/],
    })

    const req = createMockRequest({ url: '/upload/avatar' })
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    await new Promise((resolve) => setTimeout(resolve, 60))

    // Should NOT have timed out
    expect(res.statusCode).toBe(200)
    expect(res.headersSent).toBe(false)
  })

  it('allows extending timeout dynamically via req.setTimeout()', async () => {
    const handler = timeout(50)
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    // After 30ms, handler extends timeout by another 100ms
    await new Promise((resolve) => setTimeout(resolve, 30))
    ;(req as any).setTimeout(100)

    // At 60ms (original 50ms expired), request should still be alive
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(res.headersSent).toBe(false)

    // Wait until extended timeout finishes
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(res.statusCode).toBe(503)
  })

  it('allows cancelling timeout dynamically via req.clearTimeout()', async () => {
    const handler = timeout(50)
    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    handler(req, res, next)

    // Clear timeout immediately
    ;(req as any).clearTimeout()

    await new Promise((resolve) => setTimeout(resolve, 70))

    // Should NOT time out
    expect(res.headersSent).toBe(false)
  })

  it('supports route-level timeout override via router schema timeoutMs', async () => {
    const { Router } = await import('../src/router/router')
    const router = new Router()

    router.post('/heavy-task', { timeoutMs: 50 }, async (req, res) => {
      // Simulates a long running task taking 90ms
      await new Promise((resolve) => setTimeout(resolve, 90))
      res.json({ ok: true })
    })

    const req = createMockRequest({ method: 'POST', url: '/heavy-task' })
    const res = createMockResponse()

    router.handle(req, res)

    // Wait for the 50ms timeout to fire
    await new Promise((resolve) => setTimeout(resolve, 70))

    expect(res.statusCode).toBe(503)
    const body = getResponseBody<any>(res)
    expect(body.error?.code).toBe('TIMEOUT')
  })

  it('route-level timeoutMs cleanly overrides a shorter global timeout', async () => {
    const { Router } = await import('../src/router/router')
    const router = new Router()

    // Global timeout set to 40ms
    router.use(timeout(40))

    // Route overrides timeout to 120ms
    router.post('/heavy-task', { timeoutMs: 120 }, async (req, res) => {
      // Wait 70ms: longer than global (40ms), but shorter than route timeout (120ms)
      await new Promise((resolve) => setTimeout(resolve, 70))
      res.json({ success: true, processed: true })
    })

    const req = createMockRequest({ method: 'POST', url: '/heavy-task' })
    const res = createMockResponse()

    router.handle(req, res)

    // Wait 85ms: after 40ms global would have expired, but request is still alive
    await new Promise((resolve) => setTimeout(resolve, 85))

    expect(res.statusCode).toBe(200)
    const body = getResponseBody<any>(res)
    expect(body.success).toBe(true)
    expect(body.processed).toBe(true)
  })

  it('route-level timeoutMs: 0 disables any active timeout for long-lived endpoints', async () => {
    const { Router } = await import('../src/router/router')
    const router = new Router()

    // Global timeout set to 40ms
    router.use(timeout(40))

    // Route disables timeout completely
    router.post('/export-stream', { timeoutMs: 0 }, async (req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 60))
      res.json({ streamed: true })
    })

    const req = createMockRequest({ method: 'POST', url: '/export-stream' })
    const res = createMockResponse()

    router.handle(req, res)

    await new Promise((resolve) => setTimeout(resolve, 75))

    expect(res.statusCode).toBe(200)
    const body = getResponseBody<any>(res)
    expect(body.streamed).toBe(true)
  })

  it('supports declarative route.post({ timeoutMs: 120000, handle }) in route builder', async () => {
    const { route } = await import('../src/router/route-builder')

    const definition = route.post('/heavy-task', {
      timeoutMs: 120000,
      async handle() {
        return { ok: true }
      },
    })

    expect(definition.method).toBe('post')
    expect(definition.path).toBe('/heavy-task')
    expect(definition.timeoutMs).toBe(120000)
  })

  it('enforces route-level timeout in functional controller', async () => {
    const { controller, route } = await import('../src/router/route-builder')
    const { RouteScanner } = await import('../src/router/route-scanner')

    const mockApp: any = {
      options: { env: 'development' },
      log: { error: () => {}, warn: () => {}, debug: () => {} },
      pluginManager: { hasPlugin: () => false, register: async () => {} },
      resolve: () => {},
    }

    const scanner = new RouteScanner(mockApp)
    const functionalController = controller({
      heavy: route.post('/heavy-task', {
        timeoutMs: 50,
        async handle() {
          await new Promise((resolve) => setTimeout(resolve, 90))
          return { done: true }
        },
      }),
    })

    const router = (scanner as any).compileFunctionalController(
      functionalController
    )
    const req = createMockRequest({ method: 'POST', url: '/heavy-task' })
    const res = createMockResponse()

    router.handle(req, res)

    await new Promise((resolve) => setTimeout(resolve, 75))

    expect(res.statusCode).toBe(503)
    const body = getResponseBody<any>(res)
    expect(body.error?.code).toBe('TIMEOUT')
  })

  it('enforces @Timeout decorator on class controllers', async () => {
    const { Timeout, Controller, Post } = await import('../src/decorators')
    const { METHOD_MIDDLEWARES } = await import('../src/decorators/constants')
    const { MetadataEngine } = await import('../src/decorators/core/metadata')

    @Controller('/heavy')
    class HeavyController {
      @Post('/run')
      @Timeout(50)
      async run() {}
    }

    const instance = new HeavyController()
    const middlewares = MetadataEngine.get(instance.run, METHOD_MIDDLEWARES)
    expect(middlewares).toBeDefined()
    expect(middlewares?.length).toBe(1)
  })
})
