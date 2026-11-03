import { createTestContext, describe, expect, it } from 'exisjs/testing'
import app from '../src/http/server'

describe('access', () => {
  const api = createTestContext(app)

  it('answers the public health route', async () => {
    await api.get('/health').expect(200)
  })

  it('refuses anonymous callers', async () => {
    await api.get('/auth/me').expect(401)
    await api.get('/notes').expect(401)
  })

  it('refuses a state-changing request without a CSRF token', async () => {
    await api.post('/notes').send({ title: 'x', body: 'y' }).expect(403)
  })
})
