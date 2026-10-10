import { App } from '../src/server/app'
import { HttpError } from '../src/error'
import { defaultConfig, mergeConfig } from '../src/config/config'
import { createTestApp } from '../src/testing/client'
import { tex } from '../src/validator/index'
import { describe, expect, it } from '../src/testing'

describe('Error responses share one core shape', () => {
  const app = new App({ logger: false, env: 'production' })
  app.get('/http-error', () => {
    throw HttpError.forbidden('Not allowed')
  })
  app.get('/crash', () => {
    throw new TypeError('secret internal detail')
  })
  app.post(
    '/validate',
    { body: tex.object({ name: tex.string({ min: 3 }) }) },
    (_req, res) => {
      res.json({ ok: true })
    }
  )
  const client = createTestApp(app)

  const cases: [string, () => PromiseLike<any>, number, string][] = [
    ['unknown route', () => client.get('/missing'), 404, 'NOT_FOUND'],
    ['HttpError', () => client.get('/http-error'), 403, 'FORBIDDEN'],
    [
      'validation failure',
      () => client.post('/validate').send({ name: 'ab' }),
      400,
      'VALIDATION_ERROR',
    ],
    ['unexpected error', () => client.get('/crash'), 500, 'INTERNAL_ERROR'],
  ]

  for (const [name, send, status, code] of cases) {
    it(`${name} -> { success, statusCode, error: { code, message } }`, async () => {
      const res = await send()
      expect(res.status).toBe(status)
      expect(res.body.success).toBe(false)
      expect(res.body.statusCode).toBe(status)
      expect(res.body.error.code).toBe(code)
      expect(typeof res.body.error.message).toBe('string')
      expect(res.body.error.message.length > 0).toBe(true)
    })
  }

  it('does not leak internal messages in production', async () => {
    const res = await client.get('/crash')
    expect(res.text.includes('secret internal detail')).toBe(false)
  })

  it('validation errors carry field details inside error', async () => {
    const res = await client.post('/validate').send({ name: 'ab' })
    expect(res.body.error.details[0].field).toBe('name')
    // Field map kept for existing clients
    expect(Object.keys(res.body.validationErrors)).toEqual(['name'])
  })
})

describe('Config merging', () => {
  it('accumulates plugins from the config file and exis({ plugins })', () => {
    const a = { name: 'a', register: () => undefined }
    const b = { name: 'b', register: () => undefined }
    const fromFile = mergeConfig(defaultConfig, { plugins: [a] } as any)
    const merged = mergeConfig(fromFile, { plugins: [b, a] } as any)
    expect(merged.plugins!.map((p: any) => p.name)).toEqual(['a', 'b'])
  })
})

describe('Route middleware runs before validation', () => {
  it('answers 401 from auth middleware before reporting body errors', async () => {
    const app = new App({ logger: false })
    const requireToken = (req: any, _res: any, next: any) => {
      if (!req.header('authorization')) {
        next(HttpError.unauthorized('Missing token'))
        return
      }
      next()
    }
    app.post(
      '/books',
      requireToken,
      { body: tex.object({ title: tex.string() }) },
      (_req, res) => {
        res.status(201).json({ ok: true })
      }
    )
    const client = createTestApp(app)

    const anonymous = await client.post('/books').send({})
    expect(anonymous.status).toBe(401)

    const invalid = await client
      .post('/books')
      .set('Authorization', 'Bearer x')
      .send({})
    expect(invalid.status).toBe(400)

    const valid = await client
      .post('/books')
      .set('Authorization', 'Bearer x')
      .send({ title: 'Dune' })
    expect(valid.status).toBe(201)
  })
})
