import { describe, test as it, expect, createTestContext } from 'exisjs/testing'
import app from '../src/http/server'

describe('01-my-app', () => {
  // Boots the app once (running onStart) and sends requests in-process,
  // without opening a port
  const api = createTestContext(app)

  it('returns the welcome message wrapped by transformResponse', async () => {
    const res = await api.get('/').execute()
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toEqual({ message: 'Welcome to ExisJS!' })
  })

  it('rejects an invalid registration with field details', async () => {
    const res = await api
      .post('/auth/register')
      .send({ name: 'A', email: 'not-an-email', password: 'short' })
      .execute()
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('protects /users: no token, no access', async () => {
    const res = await api.get('/users').execute()
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('registers, logs in and reads protected routes with the token', async () => {
    const credentials = { email: 'ada@example.com', password: 'correct-horse' }

    const registered = await api
      .post('/auth/register')
      .send({ name: 'Ada', ...credentials })
      .execute()
    expect(registered.status).toBe(201)
    expect(registered.body.data.user).toEqual({
      id: 1,
      name: 'Ada',
      email: 'ada@example.com',
    })

    const duplicate = await api
      .post('/auth/register')
      .send({ name: 'Ada', ...credentials })
      .execute()
    expect(duplicate.status).toBe(409)

    const wrongPassword = await api
      .post('/auth/login')
      .send({ ...credentials, password: 'wrong-password' })
      .execute()
    expect(wrongPassword.status).toBe(401)

    const login = await api.post('/auth/login').send(credentials).execute()
    expect(login.status).toBe(200)
    const auth = `Bearer ${login.body.data.token}`

    const me = await api.get('/users/me').set('Authorization', auth).execute()
    expect(me.status).toBe(200)
    expect(me.body.data.email).toBe('ada@example.com')

    const byId = await api.get('/users/1').set('Authorization', auth).execute()
    expect(byId.body.data.name).toBe('Ada')

    const missing = await api
      .get('/users/999')
      .set('Authorization', auth)
      .execute()
    expect(missing.status).toBe(404)

    const badId = await api
      .get('/users/abc')
      .set('Authorization', auth)
      .execute()
    expect(badId.status).toBe(400)
  })
})
