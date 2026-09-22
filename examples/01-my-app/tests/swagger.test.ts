import { describe, test as it, expect, createTestContext } from 'exisjs/testing'
import app from '../src/http/server'

describe('Swagger & OpenAPI Documentation in 01-My-App', () => {
  const api = createTestContext(app)

  it('serves OpenAPI 3.1 JSON specification at /docs/json', async () => {
    const res = await api.get('/docs/json').execute()
    expect(res.status).toBe(200)
    const spec = res.body.data || res.body
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info.title).toContain('01-My-App')
    expect(spec.paths).toBeDefined()
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0)
  })

  it('serves interactive Swagger UI HTML at /docs', async () => {
    const res = await api.get('/docs').execute()
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(String(res.body)).toContain('swagger-ui')
    expect(String(res.body)).toContain('01-My-App')
  })
})
