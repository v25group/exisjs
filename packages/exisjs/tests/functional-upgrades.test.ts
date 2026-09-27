import { describe, it } from 'node:test'
import { expect } from '../src/testing/expect'
import { createTestApp } from '../src/testing/client'
import { App } from '../src/server/app'
import { controller, route } from '../src/router'
import { tex } from '../src/validator'
import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  ExecutionContext,
  CanActivate,
  Interceptor,
  CallHandler,
} from '../src/decorators'
import { NotFoundException } from '../src/error/errors'
import { ParseIntPipe } from '../src/decorators/pipes'
import { generateOpenApiSpec } from '../src/swagger'
import { Readable } from 'node:stream'

describe('Functional Controller Parity & Upgrades', () => {
  it('supports controller.extend for composition and inheritance', async () => {
    // Base CRUD controller definition
    const baseCrudController = controller({
      list: route.get('/items', {
        async handle() {
          return { items: ['item1', 'item2'] }
        },
      }),
      getItem: route.get('/items/:id', {
        async handle({ params }) {
          return { id: params.id, base: true }
        },
      }),
    })

    // Extended controller overriding getItem and adding createItem
    const customController = controller.extend(baseCrudController, {
      getItem: route.get('/items/:id', {
        async handle({ params }) {
          return { id: params.id, base: false, custom: true }
        },
      }),
      createItem: route.post('/items', {
        async handle({ body }) {
          return { created: true, body }
        },
      }),
    })

    const app = new App()
    app.registerFunctionalController(customController, '/api')

    const client = createTestApp(app)

    // Inherited list route
    const listRes = await client.get('/api/items')
    expect(listRes.status).toBe(200)
    expect(listRes.body).toEqual({ items: ['item1', 'item2'] })

    // Overridden getItem route
    const getRes = await client.get('/api/items/42')
    expect(getRes.status).toBe(200)
    expect(getRes.body).toEqual({ id: '42', base: false, custom: true })

    // Added createItem route
    const createRes = await client.post('/api/items', {
      body: { name: 'Widget' },
    })
    expect(createRes.status).toBe(200)
    expect(createRes.body).toEqual({ created: true, body: { name: 'Widget' } })
  })

  it('supports controller.extend and controller.merge helper APIs directly', async () => {
    const authPart = controller({
      login: route.post('/login', {
        async handle() {
          return { token: 'jwt-123' }
        },
      }),
    })

    const profilePart = controller({
      profile: route.get('/me', {
        async handle() {
          return { user: 'alice' }
        },
      }),
    })

    const merged = controller.merge(authPart, profilePart)

    const extended = controller.extend(merged, {
      extra: route.get('/extra', {
        async handle() {
          return { extra: true }
        },
      }),
    })

    const app = new App()
    app.registerFunctionalController(extended, '/v1')

    const client = createTestApp(app)

    const loginRes = await client.post('/v1/login')
    expect(loginRes.status).toBe(200)
    expect(loginRes.body).toEqual({ token: 'jwt-123' })

    const meRes = await client.get('/v1/me')
    expect(meRes.status).toBe(200)
    expect(meRes.body).toEqual({ user: 'alice' })

    const extraRes = await client.get('/v1/extra')
    expect(extraRes.status).toBe(200)
    expect(extraRes.body).toEqual({ extra: true })
  })

  it('runs class-based and functional Guards with full ExecutionContext', async () => {
    class HeaderGuard implements CanActivate {
      canActivate(context: ExecutionContext): boolean {
        if ((context as any).isPublic) return true
        const req = context.switchToHttp().getRequest()
        return req.headers['x-api-key'] === 'secret-token'
      }
    }

    const testCtrl = controller({
      guards: [HeaderGuard],
      secureRoute: route.get('/secure', {
        async handle() {
          return { secret: 'top-secret-data' }
        },
      }),
      publicRoute: route.get('/public', {
        public: true,
        async handle() {
          return { public: true }
        },
      }),
    })

    const app = new App()
    app.registerFunctionalController(testCtrl)

    const client = createTestApp(app)

    // Blocked without header
    const failRes = await client.get('/secure')
    expect(failRes.status).toBe(403)

    // Allowed with header
    const okRes = await client.get('/secure', {
      headers: { 'x-api-key': 'secret-token' },
    })
    expect(okRes.status).toBe(200)
    expect(okRes.body).toEqual({ secret: 'top-secret-data' })

    // Public route bypasses auth
    const pubRes = await client.get('/public')
    expect(pubRes.status).toBe(200)
    expect(pubRes.body).toEqual({ public: true })
  })

  it('executes Interceptors wrapping functional route execution', async () => {
    class HeaderInterceptor implements Interceptor {
      async intercept(
        context: ExecutionContext,
        next: CallHandler
      ): Promise<any> {
        const res = context.switchToHttp().getResponse()
        res.setHeader('X-Intercepted', 'functional-true')
        const result = await next.handle()
        return { ...result, intercepted: true }
      }
    }

    const testCtrl = controller({
      interceptors: [HeaderInterceptor],
      data: route.get('/interceptor-test', {
        async handle() {
          return { data: 'hello' }
        },
      }),
    })

    const app = new App()
    app.registerFunctionalController(testCtrl)

    const client = createTestApp(app)
    const res = await client.get('/interceptor-test')
    expect(res.status).toBe(200)
    expect(res.headers['x-intercepted']).toBe('functional-true')
    expect(res.body).toEqual({ data: 'hello', intercepted: true })
  })

  it('handles custom ExceptionFilters with @Catch in functional controllers', async () => {
    @Catch(NotFoundException)
    class CustomNotFoundFilter implements ExceptionFilter {
      catch(exception: NotFoundException, host: ArgumentsHost) {
        const res = host.switchToHttp().getResponse()
        res.status(404).json({
          customFilter: true,
          error: exception.message,
        })
      }
    }

    const testCtrl = controller({
      filters: [CustomNotFoundFilter],
      missing: route.get('/missing-item', {
        async handle() {
          throw new NotFoundException('Item was not found in catalog')
        },
      }),
    })

    const app = new App()
    app.registerFunctionalController(testCtrl)

    const client = createTestApp(app)
    const res = await client.get('/missing-item')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({
      customFilter: true,
      error: 'Item was not found in catalog not found',
    })
  })

  it('supports built-in Transformation Pipes in functional route configs', async () => {
    const testCtrl = controller({
      pipes: [ParseIntPipe],
      numRoute: route.get('/calc', {
        query: { n: tex.string() },
        pipes: [ParseIntPipe],
        async handle({ query }) {
          return { n: query.n, isNumber: typeof query.n === 'number' }
        },
      }),
    })

    const app = new App()
    app.registerFunctionalController(testCtrl)

    const client = createTestApp(app)
    const res = await client.get('/calc?n=42')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ n: 42, isNumber: true })
  })

  it('automatically pipes streams and async generators returned by functional handlers', async () => {
    const testCtrl = controller({
      stream: route.get('/stream', {
        handle({ res }) {
          res.type('text/plain')
          return Readable.from(['chunk1-', 'chunk2-', 'chunk3'])
        },
      }),
    })

    const app = new App()
    app.registerFunctionalController(testCtrl)

    const client = createTestApp(app)
    const res = await client.get('/stream')
    expect(res.status).toBe(200)
    expect(res.text).toBe('chunk1-chunk2-chunk3')
  })

  it('extracts Swagger / OpenAPI metadata cleanly from functional route definitions', async () => {
    const testCtrl = controller({
      tags: ['Users'],
      list: route.get('/users', {
        summary: 'List users',
        description: 'Returns active user accounts',
        tags: ['Users'],
        responses: {
          200: { description: 'Success' },
        },
        async handle() {
          return []
        },
      }),
    })

    const app = new App()
    app.registerFunctionalController(testCtrl)

    const spec = generateOpenApiSpec(app)
    expect(spec.paths['/users']).toBeDefined()
    expect(spec.paths['/users'].get.summary).toBe('List users')
    expect(spec.paths['/users'].get.description).toBe(
      'Returns active user accounts'
    )
    expect(spec.paths['/users'].get.tags).toEqual(['Users'])
    expect(spec.paths['/users'].get.responses['200'].description).toBe(
      'Success'
    )
  })
})
