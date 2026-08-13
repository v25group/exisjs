import { App } from '../src/server/app'
import { describe, expect, it } from '../src/testing'

describe('Web Standard Fetch Adapter (Edge Runtime)', () => {
  it('handles GET requests', async () => {
    const app = new App().get('/users', (req: any, res: any) => {
      res.json({ users: [1, 2, 3] })
    })

    const request = new Request('http://localhost/users', { method: 'GET' })
    const response = await app.fetch(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')

    const body = await response.json()
    expect(body).toEqual({ users: [1, 2, 3] })
  })

  it('handles POST requests with JSON body', async () => {
    const app = new App().post('/echo', async (req: any, res: any) => {
      const body = await req.json()
      res.json({ echoed: body })
    })

    const request = new Request('http://localhost/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'edge' }),
    })

    const response = await app.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body).toEqual({ echoed: { hello: 'edge' } })
  })

  it('extracts query parameters', async () => {
    const app = new App().get('/search', (req: any, res: any) => {
      res.json({ query: req.query })
    })

    const request = new Request('http://localhost/search?q=test&page=1', {
      method: 'GET',
    })
    const response = await app.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body).toEqual({ query: { q: 'test', page: '1' } })
  })

  it('preserves multiple headers correctly', async () => {
    const app = new App().get('/headers', (req: any, res: any) => {
      res.set('x-custom', ['val1', 'val2'])
      res.send('ok')
    })

    const request = new Request('http://localhost/headers', { method: 'GET' })
    const response = await app.fetch(request)

    // In the fetch standard, multiple identical headers are joined by a comma
    expect(response.headers.get('x-custom')).toBe('val1, val2')
  })
})
