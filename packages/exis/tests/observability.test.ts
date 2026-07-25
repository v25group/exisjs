import { healthCheck } from '../src/observability/health'
import { metrics } from '../src/observability/prometheus'
import { tracing } from '../src/observability/otel'
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  getResponseBody,
} from '../src/testing/mocks'

describe('Observability', () => {
  describe('Health Check Middleware', () => {
    it('returns 200 pass when no checks are provided', async () => {
      const handler = healthCheck()
      const req = createMockRequest({ method: 'GET', url: '/health' })
      const res = createMockResponse()
      const next = createMockNext()

      await handler(req, res, next)

      expect(res._statusCode).toBe(200)
      expect(getResponseBody(res)).toEqual({ status: 'pass', dependencies: {} })
      expect(next.called).toBe(false)
    })

    it('returns 405 Method Not Allowed for POST requests', async () => {
      const handler = healthCheck()
      const req = createMockRequest({ method: 'POST', url: '/health' })
      const res = createMockResponse()
      const next = createMockNext()

      await handler(req, res, next)

      expect(res._statusCode).toBe(405)
      expect(next.called).toBe(false)
    })

    it('returns 200 when all checks pass', async () => {
      const handler = healthCheck({
        checks: [
          { name: 'db', check: async () => 'connected' },
          { name: 'redis', check: () => ({ latency: 12 }) },
        ],
      })
      const req = createMockRequest({ method: 'GET', url: '/health' })
      const res = createMockResponse()
      const next = createMockNext()

      await handler(req, res, next)

      expect(res._statusCode).toBe(200)
      expect(getResponseBody(res)).toEqual({
        status: 'pass',
        dependencies: {
          db: { status: 'up', result: 'connected' },
          redis: { status: 'up', result: { latency: 12 } },
        },
      })
    })

    it('returns 503 when a check fails', async () => {
      const handler = healthCheck({
        checks: [
          { name: 'db', check: async () => 'connected' },
          {
            name: 'redis',
            check: async () => {
              throw new Error('Connection refused')
            },
          },
        ],
      })
      const req = createMockRequest({ method: 'GET', url: '/health' })
      const res = createMockResponse()
      const next = createMockNext()

      await handler(req, res, next)

      expect(res._statusCode).toBe(503)
      expect(getResponseBody(res)).toEqual({
        status: 'fail',
        dependencies: {
          db: { status: 'up', result: 'connected' },
          redis: { status: 'down', error: 'Connection refused' },
        },
      })
    })
  })

  describe('Metrics Middleware', () => {
    it('calls start and end trackers correctly', () => {
      const startTracker = jest.fn()
      const endTracker = jest.fn()
      const adapter = {
        onRequestStart: jest.fn().mockReturnValue(startTracker),
        onRequestEnd: endTracker,
      }

      const handler = metrics(adapter)
      const req = createMockRequest({ method: 'GET', url: '/users/123' })

      // Simulate route match path label
      ;(req as any).routePath = '/users/:id'

      const res = createMockResponse()
      const next = createMockNext()

      handler(req, res, next)

      expect(adapter.onRequestStart).toHaveBeenCalledWith({
        method: 'GET',
        path: '/users/:id',
      })
      expect(next.called).toBe(true)

      // Complete request
      res.status(201).end()

      expect(startTracker).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 201 })
      )
      expect(endTracker).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/users/:id',
          statusCode: 201,
        })
      )
    })
  })

  describe('Tracing Middleware (OpenTelemetry)', () => {
    it('starts and ends a span, setting status on success', () => {
      const mockSpan = {
        setAttribute: jest.fn(),
        setStatus: jest.fn(),
        recordException: jest.fn(),
        end: jest.fn(),
      }
      const adapter = {
        startActiveSpan: jest.fn((name, meta, cb) => cb(mockSpan)),
      }

      const handler = tracing(adapter)
      const req = createMockRequest({ method: 'GET', url: '/orders' })
      const res = createMockResponse()
      const next = createMockNext()

      handler(req, res, next)

      expect(adapter.startActiveSpan).toHaveBeenCalledWith(
        'GET /orders',
        expect.objectContaining({ method: 'GET', path: '/orders' }),
        expect.any(Function)
      )

      res.status(200).end()

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'http.status_code',
        200
      )
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }) // OK
      expect(mockSpan.end).toHaveBeenCalled()
    })

    it('sets ERROR status code on 500 responses', () => {
      const mockSpan = {
        setAttribute: jest.fn(),
        setStatus: jest.fn(),
        recordException: jest.fn(),
        end: jest.fn(),
      }
      const adapter = {
        startActiveSpan: jest.fn((name, meta, cb) => cb(mockSpan)),
      }

      const handler = tracing(adapter)
      const req = createMockRequest({ method: 'POST', url: '/crash' })
      const res = createMockResponse()
      const next = createMockNext()

      handler(req, res, next)
      res.status(500).end()

      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 2 }) // ERROR
    })
  })
})
