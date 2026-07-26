import { App } from '../src/server/app'
import { intercept } from '../src/middleware/interceptor'
import { describe, expect, it, ex, beforeAll, afterAll } from '../src/testing'

describe('Response Interceptor', () => {
  it('should synchronously mutate res.json payloads', async () => {
    const app = new App()
    app.use(
      intercept((data) => {
        return { success: true, data }
      })
    )

    app.get('/', () => ({ message: 'hello' }))

    const res = await app.inject({ url: '/' })
    expect(res.body).toEqual({ success: true, data: { message: 'hello' } })
  })

  it('should asynchronously mutate res.json payloads', async () => {
    const app = new App()
    app.use(
      intercept(async (data) => {
        await new Promise((r) => setTimeout(r, 10))
        return { _wrapped: data }
      })
    )

    app.get('/', () => ({ foo: 'bar' }))

    const res = await app.inject({ url: '/' })
    expect(res.body).toEqual({ _wrapped: { foo: 'bar' } })
  })

  it('should not mutate if transformer returns undefined', async () => {
    const app = new App()
    app.use(
      intercept((data) => {
        // do nothing
        return undefined
      })
    )

    app.get('/', () => ({ foo: 'bar' }))

    const res = await app.inject({ url: '/' })
    expect(res.body).toEqual({ foo: 'bar' })
  })

  it('should work with imperative res.json() calls', async () => {
    const app = new App()
    app.use(intercept((data) => ({ intercepted: data })))

    app.get('/', (req, res) => {
      res.json({ test: 123 })
    })

    const res = await app.inject({ url: '/' })
    expect(res.body).toEqual({ intercepted: { test: 123 } })
  })
})
