import { Router, runHandlers } from '../src/router/router'

import {
  createMockRequest,
  createMockResponse,
  createMockNext,
} from './helpers'
import type { Request, Response, NextFunction } from '../src/types'
import { describe, expect, it, ex, beforeAll, afterAll } from '../src/testing'
// ─── Path Compilation & Route Matching ────────────────────────────────────────

describe('Router route matching', () => {
  it('matches static paths exactly', () => {
    const router = new Router()
    router.get('/api/users', ex.fn())

    const match = router.match('GET', '/api/users')
    expect(match).not.toBeNull()
    expect(match!.params).toEqual({})
  })

  it('matches with trailing slash', () => {
    const router = new Router()
    router.get('/api/users', ex.fn())

    expect(router.match('GET', '/api/users/')).not.toBeNull()
  })

  it('extracts single dynamic param', () => {
    const router = new Router()
    router.get('/api/users/:id', ex.fn())

    const match = router.match('GET', '/api/users/123')
    expect(match).not.toBeNull()
    expect(match!.params).toEqual({ id: '123' })
  })

  it('extracts multiple dynamic params', () => {
    const router = new Router()
    router.get('/api/:org/:repo', ex.fn())

    const match = router.match('GET', '/api/exis/framework')
    expect(match).not.toBeNull()
    expect(match!.params).toEqual({ org: 'exis', repo: 'framework' })
  })

  it('decodes URI-encoded params', () => {
    const router = new Router()
    router.get('/api/users/:name', ex.fn())

    const match = router.match('GET', '/api/users/John%20Doe')
    expect(match).not.toBeNull()
    expect(match!.params).toEqual({ name: 'John Doe' })
  })

  it('matches wildcard routes', () => {
    const router = new Router()
    router.get('/api/*', ex.fn())

    const match = router.match('GET', '/api/anything/here/deeply')
    expect(match).not.toBeNull()
  })

  it('extracts named wildcard params', () => {
    const router = new Router()
    router.get('/docs/*slug', ex.fn())

    const match = router.match('GET', '/docs/getting-started/intro')
    expect(match).not.toBeNull()
    expect(match!.params).toEqual({ slug: 'getting-started/intro' })
  })

  it('returns null for unregistered paths', () => {
    const router = new Router()
    router.get('/api/users', ex.fn())

    expect(router.match('GET', '/api/products')).toBeNull()
  })

  it('returns null for wrong HTTP method', () => {
    const router = new Router()
    router.get('/api/users', ex.fn())

    expect(router.match('POST', '/api/users')).toBeNull()
  })

  it('ALL method matches any HTTP method', () => {
    const router = new Router()
    router.all('/webhook', ex.fn())

    expect(router.match('GET', '/webhook')).not.toBeNull()
    expect(router.match('POST', '/webhook')).not.toBeNull()
    expect(router.match('DELETE', '/webhook')).not.toBeNull()
    expect(router.match('PATCH', '/webhook')).not.toBeNull()
  })
})

// ─── Route Registration ──────────────────────────────────────────────────────

describe('Router route registration', () => {
  it('registers GET routes', () => {
    const router = new Router()
    const handler = ex.fn()
    router.get('/test', handler)

    const routes = router.getRoutes()
    expect(routes).toHaveLength(1)
    expect(routes[0].method).toBe('GET')
  })

  it('registers GET routes', () => {
    const router = new Router()
    const handler = ex.fn()
    router.get('/', handler)
    expect(router.match('GET', '/')).not.toBeNull()
  })

  it('registers POST routes', () => {
    const router = new Router()
    const handler = ex.fn()
    router.post('/', handler)
    expect(router.match('POST', '/')).not.toBeNull()
  })

  it('registers advanced HTTP methods (HEAD, CONNECT, TRACE, QUERY)', () => {
    const router = new Router()
    const handler = ex.fn()
    router.head('/head', handler)
    router.connect('/connect', handler)
    router.trace('/trace', handler)
    router.query('/query', handler)

    expect(router.match('HEAD', '/head')).not.toBeNull()
    expect(router.match('CONNECT', '/connect')).not.toBeNull()
    expect(router.match('TRACE', '/trace')).not.toBeNull()
    expect(router.match('QUERY', '/query')).not.toBeNull()
  })

  it('registers PUT routes', () => {
    const router = new Router()
    router.put('/test', ex.fn())
    expect(router.getRoutes()[0].method).toBe('PUT')
  })

  it('registers PATCH routes', () => {
    const router = new Router()
    router.patch('/test', ex.fn())
    expect(router.getRoutes()[0].method).toBe('PATCH')
  })

  it('registers DELETE routes', () => {
    const router = new Router()
    router.delete('/test', ex.fn())
    expect(router.getRoutes()[0].method).toBe('DELETE')
  })

  it('registers HEAD routes', () => {
    const router = new Router()
    router.head('/test', ex.fn())
    expect(router.getRoutes()[0].method).toBe('HEAD')
  })

  it('registers OPTIONS routes', () => {
    const router = new Router()
    router.options('/test', ex.fn())
    expect(router.getRoutes()[0].method).toBe('OPTIONS')
  })

  it('returns this for chaining', () => {
    const router = new Router()
    const result = router.get('/a', ex.fn()).post('/b', ex.fn())
    expect(result).toBe(router)
  })
})

// ─── Middleware ────────────────────────────────────────────────────────────────

describe('Router middleware', () => {
  it('prepends middleware to route handlers', () => {
    const middleware = ex.fn(
      (_req: Request, _res: Response, next: NextFunction) => next()
    )
    const handler = ex.fn()

    const router = new Router()
    router.use(middleware)
    router.get('/test', handler)

    const routes = router.getRoutes()
    expect(routes[0].handlers).toHaveLength(2)
    expect(routes[0].handlers[0]).toBe(middleware)
    expect(routes[0].handlers[1]).toBe(handler)
  })

  it('returns this for chaining', () => {
    const router = new Router()
    expect(router.use(ex.fn())).toBe(router)
  })
})

// ─── Route Groups ─────────────────────────────────────────────────────────────

describe('Router groups', () => {
  it('prepends group prefix to routes', () => {
    const router = new Router()
    router.group('/admin', (admin) => {
      admin.get('/dashboard', ex.fn())
      admin.get('/users', ex.fn())
    })

    const routes = router.getRoutes()
    expect(routes).toHaveLength(2)
    expect(routes[0].path).toBe('/admin/dashboard')
    expect(routes[1].path).toBe('/admin/users')
  })

  it('inherits parent middleware into group', () => {
    const parentMiddleware = ex.fn()
    const router = new Router()
    router.use(parentMiddleware)

    router.group('/admin', (admin) => {
      admin.get('/test', ex.fn())
    })

    const routes = router.getRoutes()
    // First handler should be the inherited middleware
    expect(routes[0].handlers[0]).toBe(parentMiddleware)
  })

  it('returns this for chaining', () => {
    const router = new Router()
    expect(router.group('/test', () => {})).toBe(router)
  })
})

// ─── Handler Execution ───────────────────────────────────────────────────────

describe('Router.handle()', () => {
  it('sets req.params from matched route', async () => {
    const router = new Router()
    router.get('/users/:id', (req, res) => {
      res.json({ id: req.params.id })
    })

    const req = createMockRequest({ method: 'GET', url: '/users/42' })
    const res = createMockResponse()

    await new Promise<void>((resolve, reject) => {
      res.raw.on('finish', resolve)
      router.handle(req, res, (err) => (err ? reject(err) : resolve()))
    })

    expect(req.params).toEqual({ id: '42' })
  })

  it('calls fallthrough when no route matches', async () => {
    const router = new Router()
    const fallthrough = ex.fn()

    const req = createMockRequest({ method: 'GET', url: '/not-found' })
    const res = createMockResponse()

    await new Promise<void>((resolve, reject) => {
      router.handle(req, res, (err) => {
        fallthrough(err)
        resolve()
      })
    })

    expect(fallthrough).toHaveBeenCalled()
  })
})

// ─── runHandlers Pipeline ────────────────────────────────────────────────────

describe('runHandlers()', () => {
  it('executes handlers sequentially', async () => {
    const order: number[] = []

    const handlers = [
      (_req: Request, _res: Response, next: NextFunction) => {
        order.push(1)
        next()
      },
      (_req: Request, _res: Response, next: NextFunction) => {
        order.push(2)
        next()
      },
      (_req: Request, _res: Response, next: NextFunction) => {
        order.push(3)
        next()
      },
    ]

    const req = createMockRequest()
    const res = createMockResponse()

    await new Promise<void>((resolve, reject) => {
      runHandlers(handlers, req, res, (err) => (err ? reject(err) : resolve()))
    })

    expect(order).toEqual([1, 2, 3])
  })

  it('stops chain when next() is not called', async () => {
    const order: number[] = []

    const handlers = [
      (_req: Request, _res: Response, _next: NextFunction) => {
        order.push(1)
      }, // no next()
      (_req: Request, _res: Response, _next: NextFunction) => {
        order.push(2)
      },
    ]

    const req = createMockRequest()
    const res = createMockResponse()

    runHandlers(handlers, req, res)

    expect(order).toEqual([1])
  })

  it('passes error to done callback on next(err)', async () => {
    const error = new Error('test error')
    const done = ex.fn()

    const handlers = [
      (_req: Request, _res: Response, next: NextFunction) => {
        next(error)
      },
      ex.fn(), // should never run
    ]

    const req = createMockRequest()
    const res = createMockResponse()

    await runHandlers(handlers, req, res, done)

    expect(done).toHaveBeenCalledWith(error)
    expect(handlers[1]).not.toHaveBeenCalled()
  })

  it('catches thrown errors and passes to done', async () => {
    const error = new Error('thrown')
    const done = ex.fn()

    const handlers = [
      () => {
        throw error
      },
    ]

    const req = createMockRequest()
    const res = createMockResponse()

    await runHandlers(handlers, req, res, done)

    expect(done).toHaveBeenCalledWith(error)
  })

  it('handles async handlers', async () => {
    const order: number[] = []

    const handlers = [
      async (_req: Request, _res: Response, next: NextFunction) => {
        await new Promise((r) => setTimeout(r, 10))
        order.push(1)
        next()
      },
      (_req: Request, _res: Response, next: NextFunction) => {
        order.push(2)
        next()
      },
    ]

    const req = createMockRequest()
    const res = createMockResponse()

    await new Promise<void>((resolve, reject) => {
      runHandlers(handlers, req, res, (err) => (err ? reject(err) : resolve()))
    })

    expect(order).toEqual([1, 2])
  })

  it('calls done() when all handlers complete', async () => {
    const done = ex.fn()

    const handlers = [
      (_req: Request, _res: Response, next: NextFunction) => next(),
    ]

    const req = createMockRequest()
    const res = createMockResponse()

    await runHandlers(handlers, req, res, done)

    expect(done).toHaveBeenCalledWith() // no error
  })
})
