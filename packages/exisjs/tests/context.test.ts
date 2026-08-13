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
})
