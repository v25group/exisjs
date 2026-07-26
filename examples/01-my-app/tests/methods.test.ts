import { describe, test as it, expect, createTestContext } from 'exisjs/testing'
import app from '../src/http/server'

describe('HTTP Methods Tests', () => {
  const api = createTestContext(app)

  it('should handle PUT requests', async () => {
    const res = await api.put('/methods').execute()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { method: 'PUT' } })
  })

  it('should handle PATCH requests', async () => {
    const res = await api.patch('/methods').execute()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { method: 'PATCH' } })
  })

  it('should handle DELETE requests', async () => {
    const res = await api.delete('/methods').execute()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { method: 'DELETE' } })
  })

  it('should handle OPTIONS requests', async () => {
    const res = await api.options('/methods').execute()
    // With preflightContinue enabled, the handler is invoked!
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { method: 'OPTIONS' } })
  })

  it('should handle HEAD requests', async () => {
    const res = await api.head('/methods').execute()
    expect(res.status).toBe(200)
    // HEAD requests generally do not return a body, but let's check what our interceptor/framework does
  })

  // TRACE is intentionally blocked by the native Fetch API (which app.inject() uses)
  // to prevent Cross-Site Tracing (XST) attacks. The route itself compiles perfectly,
  // but we cannot trigger it using the test client.
  /*
  it('should handle TRACE requests', async () => {
    const res = await api.trace('/methods').execute()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { method: 'TRACE' } })
  })
  */

  it('should handle QUERY requests', async () => {
    // Custom HTTP method 'QUERY'
    const res = await api.query('/methods').execute()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { method: 'QUERY' } })
  })

  it('should handle route.all for any method', async () => {
    const getRes = await api.get('/methods/all').execute()
    expect(getRes.status).toBe(200)
    expect(getRes.body).toEqual({ success: true, data: { method: 'GET' } })

    const postRes = await api.post('/methods/all').execute()
    expect(postRes.status).toBe(200)
    expect(postRes.body).toEqual({ success: true, data: { method: 'POST' } })
  })
})
