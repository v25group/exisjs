import { exis } from '../src'
import { getContext, setContext, after } from '../src/router/index'
import { createTestApp } from '../src/testing/client'
import { describe, expect, it, ex } from '../src/testing'

describe('Context API & after()', () => {
  it('should isolate context state across requests', async () => {
    const mockService = () => {
      const state = getContext<{ userId: string }>()
      return state.userId
    }

    const app = exis({
      asyncContext: true,
      async onStart(activeApp) {
        activeApp.get('/user/:id', (req, res) => {
          setContext('userId', req.params.id)

          // Simulate async work
          setTimeout(() => {
            const idFromContext = mockService()
            res.json({ contextId: idFromContext })
          }, 10)
        })
      },
    })

    const server = createTestApp(app)

    const [res1, res2] = await Promise.all([
      server.get('/user/1'),
      server.get('/user/2'),
    ])

    expect(res1.body.contextId).toBe('1')
    expect(res2.body.contextId).toBe('2')
  })

  it('should run after() callbacks when the response finishes', async () => {
    let afterExecuted = false

    const app = exis({
      asyncContext: true,
      async onStart(activeApp) {
        activeApp.get('/background', (req, res) => {
          after(() => {
            afterExecuted = true
          })
          res.json({ success: true })
        })
      },
    })

    const server = createTestApp(app)
    const res = await server.get('/background')

    expect(res.status).toBe(200)

    // Wait a brief moment to allow the 'finish' event to trigger the after callback
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(afterExecuted).toBe(true)
  })

  it('should throw an error if called outside a request', () => {
    expect(() => getContext()).toThrow(
      'getContext() must be called during an active request lifecycle. Ensure asyncContext: true is set in createApp() options.'
    )
    expect(() => after(() => {})).toThrow(
      'after() must be called during an active request lifecycle. Ensure asyncContext: true is set in createApp() options.'
    )
  })

  it('guarantees context isolation under high concurrency with interleaved async tasks', async () => {
    const app = exis({
      asyncContext: true,
      async onStart(activeApp) {
        activeApp.get('/concurrent/:id', (req, res) => {
          setContext('id', req.params.id)
          setContext('timestamp', Date.now())

          const delay = Math.floor(Math.random() * 20) + 5
          setTimeout(() => {
            const ctx = getContext<{ id: string; timestamp: number }>()
            res.json({ id: ctx.id, matches: ctx.id === req.params.id })
          }, delay)
        })
      },
    })

    const server = createTestApp(app)
    const requestCount = 50

    const results = await Promise.all(
      Array.from({ length: requestCount }, (_, i) =>
        server.get(`/concurrent/req_${i}`)
      )
    )

    for (let i = 0; i < requestCount; i++) {
      expect(results[i].status).toBe(200)
      expect(results[i].body.id).toBe(`req_${i}`)
      expect(results[i].body.matches).toBe(true)
    }
  })

  it('cleans up context state, diCache, and circular references when response finishes', async () => {
    let capturedStore: any = null

    const app = exis({
      asyncContext: true,
      async onStart(activeApp) {
        activeApp.get('/leak-test', (req, res) => {
          setContext('secretData', 'sensitive-token')
          const { executionContext } = require('../src/server/context')
          capturedStore = executionContext.getStore()

          // Populate diCache
          capturedStore.diCache.set('TestService', { instance: 123 })

          res.json({ ok: true })
        })
      },
    })

    const server = createTestApp(app)
    const res = await server.get('/leak-test')

    expect(res.status).toBe(200)

    // Await finish event processing
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(capturedStore).toBeDefined()
    expect(capturedStore.cleanedUp).toBe(true)
    expect(capturedStore.diCache.size).toBe(0)
    expect(Object.keys(capturedStore.state).length).toBe(0)
    expect(capturedStore.req).toBeNull()
    expect(capturedStore.res).toBeNull()
    expect(capturedStore.app).toBeNull()
  })

  it('cleans up context gracefully when unhandled errors occur inside route handlers', async () => {
    let capturedStore: any = null

    const app = exis({
      asyncContext: true,
      async onStart(activeApp) {
        activeApp.get('/error-test', (req, res) => {
          setContext('failedData', 'error-value')
          const { executionContext } = require('../src/server/context')
          capturedStore = executionContext.getStore()
          throw new Error('Intentional route crash')
        })

        activeApp.get('/subsequent', (req, res) => {
          const state = getContext()
          res.json({ stateKeys: Object.keys(state) })
        })
      },
    })

    const server = createTestApp(app)
    const errRes = await server.get('/error-test')
    expect(errRes.status).toBe(500)

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(capturedStore.cleanedUp).toBe(true)

    // Verify subsequent request has a clean, uncorrupted context
    const nextRes = await server.get('/subsequent')
    expect(nextRes.status).toBe(200)
    expect(nextRes.body.stateKeys).toEqual([])
  })
})
