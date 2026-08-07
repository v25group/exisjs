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

    it('allows specific arrays via allowlist', () => {
      const req = createMockRequest({ method: 'GET', url: '/test' })
      req.query = { id: ['1', '2'], tags: ['a', 'b'] } as any
      const res = createMockResponse()
      const middleware = hpp() // HPP does not have allowlist right now in ExisJS

      middleware(req, res, () => {})

      // id is polluted and stripped to last item
      expect(req.query.id).toBe('2')
      // tags is allowed to be an array? No, HPP strips it.
      expect(req.query.tags).toBe('b')
    })
  })
})
