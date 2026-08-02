import { App } from '../src/server/app'
import { cacheMiddleware } from '../src/middleware/cache'
import { MemoryCacheStore } from '../src/cache/store'
import { dedupeMiddleware } from '../src/middleware/dedupe'
import { backpressureMiddleware } from '../src/middleware/backpressure'
import { ipFilterMiddleware } from '../src/middleware/ip-filter'
import {
  CircuitBreaker,
  CircuitBreakerError,
  CircuitState,
} from '../src/utils/circuit-breaker'
import {
  createMockRequest,
  createMockResponse,
  getResponseHeader,
  getResponseBody,
} from './helpers'
import { describe, expect, it } from '../src/testing'

describe('Advanced Middleware', () => {
  describe('Cache Middleware', () => {
    it('caches GET responses in memory', async () => {
      const store = new MemoryCacheStore()
      const middleware = cacheMiddleware({
        store,
        ttlMs: 1000,
        keyGenerator: (req: any) => req.path,
      })

      let callCount = 0

      const req = createMockRequest({ method: 'GET', url: '/data' })
      const res = createMockResponse()

      // Request 1: should miss
      await new Promise<void>((resolve) => {
        middleware(req, res, () => {
          callCount++
          res.json({ hello: 'world' })
          resolve()
        })
      })

      expect(getResponseHeader(res, 'x-exis-cache')).toBe('MISS')
      expect(getResponseBody(res)).toEqual({ hello: 'world' })
      expect(callCount).toBe(1)

      // Request 2: should hit
      const res2 = createMockResponse()
      await new Promise<void>((resolve) => {
        middleware(req, res2, () => {
          callCount++ // Shouldn't be called
        })
        resolve()
      })

      // Delay slightly for Promise.resolve in cache set to finish
      await new Promise((r) => setTimeout(r, 10))

      const req3 = createMockRequest({ method: 'GET', url: '/data' })
      const res3 = createMockResponse()
      await new Promise<void>((resolve) => {
        middleware(req3, res3, () => {
          callCount++ // Shouldn't be called
        })
        // middleware might end request synchronously if cache hit
        resolve()
      })

      expect(getResponseHeader(res3, 'x-exis-cache')).toBe('HIT')
      expect(getResponseBody(res3)).toEqual({ hello: 'world' })
      expect(callCount).toBe(1) // still 1
    })

    it('separates cache by identity if keyGenerator includes user ID', async () => {
      const store = new MemoryCacheStore()
      const middleware = cacheMiddleware({
        store,
        ttlMs: 1000,
        keyGenerator: (req: any) => `${req.user?.id}:${req.path}`,
      })

      let callCount = 0

      // User A requests /data
      const reqA = createMockRequest({ method: 'GET', url: '/data' })
      ;(reqA as any).user = { id: 'user-a' }
      const resA = createMockResponse()

      // User B requests /data
      const reqB = createMockRequest({ method: 'GET', url: '/data' })
      ;(reqB as any).user = { id: 'user-b' }
      const resB = createMockResponse()

      await new Promise<void>((resolve) => {
        middleware(reqA, resA, () => {
          callCount++
          resA.json({ data: 'A' })
          resolve()
        })
      })

      await new Promise<void>((resolve) => {
        middleware(reqB, resB, () => {
          callCount++
          resB.json({ data: 'B' })
          resolve()
        })
      })

      expect(callCount).toBe(2)
      expect(getResponseHeader(resA, 'x-exis-cache')).toBe('MISS')
      expect(getResponseHeader(resB, 'x-exis-cache')).toBe('MISS')
      expect(getResponseBody(resA)).toEqual({ data: 'A' })
      expect(getResponseBody(resB)).toEqual({ data: 'B' })

      // User A requests again
      const resA2 = createMockResponse()
      await new Promise<void>((resolve) => {
        middleware(reqA, resA2, () => {
          callCount++ // Shouldn't be called
        })
        resolve()
      })
      // Delay slightly for Promise.resolve
      await new Promise((r) => setTimeout(r, 10))

      expect(callCount).toBe(2)
      expect(getResponseHeader(resA2, 'x-exis-cache')).toBe('HIT')
    })
  })

  describe('Deduplication Middleware', () => {
    it('deduplicates concurrent requests', async () => {
      const middleware = dedupeMiddleware({
        keyGenerator: (req: any) => req.path,
      })
      let callCount = 0

      const req1 = createMockRequest({ method: 'GET', url: '/slow' })
      const req2 = createMockRequest({ method: 'GET', url: '/slow' })

      const res1 = createMockResponse()
      const res2 = createMockResponse()

      // Start both requests
      const p1 = new Promise<void>((resolve) => {
        middleware(req1, res1, () => {
          callCount++
          // Simulate slow processing
          setTimeout(() => {
            res1.json({ data: 42 })
          }, 50)
          resolve()
        })
      })

      const p2 = new Promise<void>((resolve) => {
        middleware(req2, res2, () => {
          callCount++ // shouldn't happen
        })
        resolve() // Resolve immediately since it's queued
      })

      await Promise.all([p1, p2])

      // Wait for the timeout to finish and responses to complete
      await new Promise((r) => setTimeout(r, 100))

      expect(callCount).toBe(1)
      expect(getResponseBody(res1)).toEqual({ data: 42 })
      expect(getResponseBody(res2)).toEqual({ data: 42 })
    })

    it('does not deduplicate concurrent requests from different identities', async () => {
      const middleware = dedupeMiddleware({
        keyGenerator: (req: any) => `${req.user?.id}:${req.path}`,
      })
      let callCount = 0

      const reqA = createMockRequest({ method: 'GET', url: '/slow' })
      ;(reqA as any).user = { id: 'user-a' }
      const reqB = createMockRequest({ method: 'GET', url: '/slow' })
      ;(reqB as any).user = { id: 'user-b' }

      const resA = createMockResponse()
      const resB = createMockResponse()

      const pA = new Promise<void>((resolve) => {
        middleware(reqA, resA, () => {
          callCount++
          setTimeout(() => {
            resA.json({ data: 'A' })
            resolve()
          }, 20)
        })
      })

      const pB = new Promise<void>((resolve) => {
        middleware(reqB, resB, () => {
          callCount++
          setTimeout(() => {
            resB.json({ data: 'B' })
            resolve()
          }, 20)
        })
      })

      await Promise.all([pA, pB])

      expect(callCount).toBe(2)
      expect(getResponseBody(resA)).toEqual({ data: 'A' })
      expect(getResponseBody(resB)).toEqual({ data: 'B' })
    })
  })

  describe('Backpressure Middleware', () => {
    it('returns 503 when queue is full', () => {
      // Allow 1 active, 1 queued
      const middleware = backpressureMiddleware({
        maxConcurrent: 1,
        maxQueue: 1,
        timeoutMs: 1000,
      })

      const req1 = createMockRequest()
      const res1 = createMockResponse()
      const req2 = createMockRequest()
      const res2 = createMockResponse()
      const req3 = createMockRequest()
      const res3 = createMockResponse()

      let nextCalledCount = 0

      // Request 1 goes through
      middleware(req1, res1, (err) => {
        expect(err).toBeUndefined()
        nextCalledCount++
      })

      // Request 2 gets queued
      middleware(req2, res2, (err) => {
        expect(err).toBeUndefined()
        nextCalledCount++
      })

      // Request 3 should be rejected with 503 immediately
      let error: any
      middleware(req3, res3, (err) => {
        error = err
      })

      expect(error).toBeDefined()
      expect(error.statusCode).toBe(503)
      expect(nextCalledCount).toBe(1) // Only req1 actually ran

      // Cleanup
      res1.end()
      res2.end()
    })
  })

  describe('IP Filter Middleware', () => {
    it('allows valid IP', () => {
      const middleware = ipFilterMiddleware({ allowlist: ['192.168.1.1'] })
      const req = createMockRequest({
        socket: { remoteAddress: '192.168.1.1' } as any,
      })
      const res = createMockResponse()

      let err: any
      middleware(req, res, (e) => (err = e))
      expect(err).toBeUndefined()
    })

    it('blocks invalid IP', () => {
      const middleware = ipFilterMiddleware({ allowlist: ['192.168.1.1'] })
      const req = createMockRequest({
        socket: { remoteAddress: '10.0.0.1' } as any,
      })
      const res = createMockResponse()

      let err: any
      middleware(req, res, (e) => (err = e))
      expect(err).toBeDefined()
      expect(err.statusCode).toBe(403)
    })
  })

  describe('Circuit Breaker', () => {
    it('opens after threshold and allows half-open test', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 50,
      })

      const failAction = async () => {
        throw new Error('Fail')
      }
      const successAction = async () => 'Success'

      // Fail 1
      await expect(breaker.fire(failAction)).rejects.toThrow('Fail')
      expect(breaker.state).toBe(CircuitState.CLOSED)

      // Fail 2 - Should open
      await expect(breaker.fire(failAction)).rejects.toThrow('Fail')
      expect(breaker.state).toBe(CircuitState.OPEN)

      // Fail 3 - Should fast fail with CircuitBreakerError
      await expect(breaker.fire(failAction)).rejects.toThrow(
        CircuitBreakerError
      )

      // Wait for reset timeout
      await new Promise((r) => setTimeout(r, 60))

      // Half Open Test
      const result = await breaker.fire(successAction)
      expect(result).toBe('Success')
      expect(breaker.state).toBe(CircuitState.CLOSED)
    })
  })
})
