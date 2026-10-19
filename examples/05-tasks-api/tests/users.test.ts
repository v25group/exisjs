import { describe, it, expect, createTestContext } from 'exisjs/testing'
import server from '../src/http/server'

describe('Users API', () => {
  const api = createTestContext(server)

  it('should return 200 at /users', async () => {
    const res = await api.get('/users')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})
