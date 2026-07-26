import { exis } from '../src'
import { getContext, setContext, after } from '../src/exports/route'
import request from 'supertest'
import { describe, expect, it, ex } from '../src/testing'

describe('Context API & after()', () => {
  it('should isolate context state across requests', async () => {
    const app = exis()

    const mockService = () => {
      const state = getContext<{ userId: string }>()
      return state.userId
    }

    app.get('/user/:id', (req, res) => {
      setContext('userId', req.params.id)

      // Simulate async work
      setTimeout(() => {
        const idFromContext = mockService()
        res.json({ contextId: idFromContext })
      }, 10)
    })

    const server = app.getServer()

    const [res1, res2] = await Promise.all([
      request(server).get('/user/1'),
      request(server).get('/user/2'),
    ])

    expect(res1.body.contextId).toBe('1')
    expect(res2.body.contextId).toBe('2')
  })

  it('should run after() callbacks when the response finishes', async () => {
    const app = exis()

    let afterExecuted = false

    app.get('/background', (req, res) => {
      after(() => {
        afterExecuted = true
      })
      res.json({ success: true })
    })

    const server = app.getServer()
    const res = await request(server).get('/background')

    expect(res.statusCode).toBe(200)

    // Wait a brief moment to allow the 'finish' event to trigger the after callback
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(afterExecuted).toBe(true)
  })

  it('should throw an error if called outside a request', () => {
    expect(() => getContext()).toThrow(
      'getContext() can only be called inside an active Exis request handler.'
    )
    expect(() => after(() => {})).toThrow(
      'after() can only be called inside an active Exis request handler.'
    )
  })
})
