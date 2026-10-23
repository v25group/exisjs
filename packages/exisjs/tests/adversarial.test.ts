import { App } from '../src/server/app'
import {
  createMockRequest,
  createMockResponse,
  getResponseBody,
} from './helpers'
import { describe, expect, it } from '../src/testing'
import { mongoSanitize, hpp } from '../src/middleware/security'

describe('Adversarial Security Tests', () => {
  describe('Sanitize Middleware (XSS & NoSQL)', () => {
    it('strips NoSQL injection payloads starting with $', () => {
      const req = createMockRequest({ method: 'POST', url: '/test' })
      req.query = {}
      req.params = {}
      req.body = {
        username: 'admin',
        password: { $gt: '' }, // NoSQL bypass attempt
        $where: 'sleep(1000)',
      }
      const res = createMockResponse()
      const middleware = mongoSanitize()

      middleware(req, res, () => {})

      expect((req.body as any).username).toBe('admin')
      // $gt should be stripped completely, making it an empty object or stripping the key
      expect((req.body as any).password).toEqual({})
      expect((req.body as any).$where).toBeUndefined()
    })

    it('keeps dotted keys with allowDots, still strips $ keys', () => {
      const req = createMockRequest({ method: 'GET', url: '/hook' })
      req.query = { 'hub.mode': 'subscribe', $where: 'x' } as any
      mongoSanitize({ allowDots: true })(req, createMockResponse(), () => {})

      expect(req.query).toEqual({ 'hub.mode': 'subscribe' })
    })

    it('leaves excluded paths untouched', () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/webhooks/whatsapp?x=1',
      })
      req.query = { 'hub.challenge': '42' } as any
      mongoSanitize({ exclude: [/^\/webhooks\//] })(
        req,
        createMockResponse(),
        () => {}
      )

      expect(req.query).toEqual({ 'hub.challenge': '42' })
    })

    it('does not parse a body that is not JSON or a form', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/upload',
        headers: { 'content-type': 'text/plain' },
      })
      req.rawBody = '{"$where":"x"}'
      await mongoSanitize()(req, createMockResponse(), () => {})

      expect(req.body).toBeUndefined()
    })
  })

  describe('HTTP Parameter Pollution (HPP)', () => {
    it('takes the last parameter if multiple are provided', () => {
      const req = createMockRequest({ method: 'GET', url: '/test' })
      req.query = { id: ['1', '2', '3'] } as any
      const res = createMockResponse()
      const middleware = hpp()

      middleware(req, res, () => {})

      // HPP should leave the last element as a string
      expect(req.query.id).toBe('3')
    })

    it('lets whitelisted query keys repeat', () => {
      const req = createMockRequest({ method: 'GET', url: '/test' })
      req.query = { id: ['1', '2'], tags: ['a', 'b'] } as any
      hpp({ whitelist: ['tags'] })(req, createMockResponse(), () => {})

      expect(req.query.id).toBe('2')
      expect(req.query.tags).toEqual(['a', 'b'])
    })

    it('keeps arrays in a JSON body', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/test',
        headers: { 'content-type': 'application/json' },
        body: { permissions: ['leads.read', 'payments.record'] },
      })
      await hpp()(req, createMockResponse(), () => {})

      expect((req.body as any).permissions).toEqual([
        'leads.read',
        'payments.record',
      ])
    })

    it('takes the last value of a repeated form field', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/test',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
      req.rawBody = 'role=user&role=admin&name=x'
      await hpp()(req, createMockResponse(), () => {})

      expect((req.body as any).role).toBe('admin')
      expect((req.body as any).name).toBe('x')
    })

    it('keeps JSON arrays through the router with a strict schema', async () => {
      const { createTestApp } = await import('../src/testing')
      const { tex } = await import('../src/validator/tex')
      const { controller, route } = await import('../src/router/route-builder')
      const app = new App()
      app.use(hpp())
      app.registerFunctionalController(
        controller({
          save: route.post('/ids', {
            body: tex.object({ ids: tex.array(tex.string()) }),
            handle: ({ body }: any) => body,
          }),
        })
      )
      const res = await createTestApp(app)
        .post('/ids')
        .send({ ids: ['a', 'b'] })
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ids: ['a', 'b'] })
    })
  })
})
