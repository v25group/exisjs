// Regression tests for the findings in docs/REPORTS.md and docs/REPORT2.md.
// Each describe block names the finding it covers (BUG-xx, T-xx).
import {
  describe,
  it,
  expect,
  createTestApp,
  startTestServer,
} from '../src/testing'
import { App } from '../src/server/app'
import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  Injectable,
  UseInterceptors,
  Idempotent,
  HttpCode,
  Permissions,
  Roles,
  Public,
  type Interceptor,
  type ExecutionContext,
  type CallHandler,
} from '../src/decorators'
import { Inject } from '../src/di'
import { download } from '../src/response'
import { controller, route } from '../src/router'
import type { Response } from '../src/types'
import {
  tex,
  type ResolveSchema,
  type ResolveInput,
  type ResolveOutput,
} from '../src/validator'
import { mountDocumentation } from '../src/swagger/mounter'
import { rateLimit, MemoryRateLimitStore } from '../src/middleware/rate-limit'
import { createTempDir, writeTempFile, cleanupTempDir } from './helpers'
import path from 'node:path'

describe('T-03 / BUG-10: returning a response method result (class)', () => {
  @Controller('/r')
  class ResponsesController {
    @Get('/json')
    json(@Res() res: Response) {
      return res.status(201).json({ ok: true })
    }

    @Get('/send')
    send(@Res() res: Response) {
      res.setHeader('Content-Type', 'text/csv')
      return res.send('a,b')
    }

    @Get('/download')
    file() {
      return download('a,b\n1,2', 'report.csv')
    }

    @Get('/buffer')
    buffer() {
      return Buffer.from('binary-data')
    }

    @Get('/null')
    nothing() {
      return null
    }

    @Get('/text')
    text() {
      return 'plain'
    }
  }

  const app = new App()
  app.registerControllers([ResponsesController])
  const client = createTestApp(app)

  it('return res.status().json() sends the payload', async () => {
    const res = await client.get('/r/json')
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ok: true })
  })

  it('return res.send() sends the given text', async () => {
    const res = await client.get('/r/send')
    expect(res.text).toBe('a,b')
    expect(res.headers['content-type']).toBe('text/csv')
  })

  it('return download() sends an attachment', async () => {
    const res = await client.get('/r/download')
    expect(res.text).toBe('a,b\n1,2')
    expect(String(res.headers['content-disposition'])).toContain('report.csv')
  })

  it('T-13: a returned Buffer is sent as application/octet-stream', async () => {
    const res = await client.get('/r/buffer')
    expect(res.headers['content-type']).toBe('application/octet-stream')
    expect(res.text).toBe('binary-data')
  })

  it('T-24: a returned null is JSON null', async () => {
    const res = await client.get('/r/null')
    expect(res.status).toBe(200)
    expect(String(res.headers['content-type'])).toContain('application/json')
    expect(res.text).toBe('null')
  })

  it('a returned string is sent as text', async () => {
    const res = await client.get('/r/text')
    expect(res.text).toBe('plain')
    expect(String(res.headers['content-type'])).toContain('text/plain')
  })
})

describe('T-05: @UseInterceptors (class)', () => {
  let calls = 0

  class WrapInterceptor implements Interceptor {
    async intercept(_ctx: ExecutionContext, next: CallHandler) {
      const data = await next.handle()
      return { wrapped: data }
    }
  }

  @Controller('/i')
  class InterceptedController {
    @Get('/')
    @UseInterceptors(WrapInterceptor)
    get() {
      calls++
      return { n: 1 }
    }
  }

  const app = new App()
  app.registerControllers([InterceptedController])
  const client = createTestApp(app)

  it('uses the interceptor result and runs the handler once', async () => {
    const res = await client.get('/i')
    expect(res.body).toEqual({ wrapped: { n: 1 } })
    expect(calls).toBe(1)
  })
})

describe('T-06: malformed JSON', () => {
  @Controller('/j')
  class JsonController {
    @Post('/')
    create(@Body() body: unknown) {
      return { body }
    }
  }

  const app = new App()
  app.registerControllers([JsonController])
  const client = createTestApp(app)

  it('answers 400 INVALID_JSON instead of treating it as {}', async () => {
    const res = await client.post('/j', {
      headers: { 'content-type': 'application/json' },
      body: '{"a":1,',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_JSON')
  })

  it('still accepts an empty body', async () => {
    const res = await client.post('/j', {
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(200)
  })
})

describe('T-01 / T-12: DI scopes', () => {
  let created = 0

  @Injectable({ scope: 'request' })
  class RequestState {
    id = ++created
  }

  @Injectable({ scope: 'transient' })
  class Transient {}

  @Controller('/di')
  class ScopedController {
    constructor(
      @Inject(RequestState) private readonly state: RequestState,
      @Inject(Transient) private readonly a: Transient,
      @Inject(Transient) private readonly b: Transient
    ) {}

    @Get('/request')
    request() {
      return { id: this.state.id }
    }

    @Get('/transient')
    transient() {
      return { same: this.a === this.b }
    }
  }

  const app = new App()
  app.registerControllers([ScopedController])
  const client = createTestApp(app)

  it('creates a request-scoped provider for every request', async () => {
    const first = await client.get('/di/request')
    const second = await client.get('/di/request')
    expect(first.status).toBe(200)
    expect(first.body.id).not.toBe(second.body.id)
  })

  it('creates a transient provider for every injection', async () => {
    const res = await client.get('/di/transient')
    expect(res.body.same).toBe(false)
  })
})

describe('T-04: @Idempotent', () => {
  let charged = 0

  @Controller('/pay')
  class PaymentController {
    @Post('/')
    @Idempotent()
    pay(@Body() body: { amount: number }) {
      charged += body.amount
      return { charged: body.amount }
    }
  }

  const app = new App()
  app.use((req: any, _res: any, next: any) => {
    const user = req.headers['x-user']
    if (user) req.user = { id: user }
    next()
  })
  app.registerControllers([PaymentController])
  const client = createTestApp(app)

  const pay = (user: string, key: string, amount: number) =>
    client.post('/pay', {
      headers: { 'x-user': user, 'idempotency-key': key },
      body: { amount },
    })

  it('replays the first response for the same user, key and body', async () => {
    const first = await pay('alice', 'k1', 5)
    const again = await pay('alice', 'k1', 5)
    expect(first.body).toEqual({ charged: 5 })
    expect(again.body).toEqual({ charged: 5 })
    expect(charged).toBe(5)
  })

  it('keeps keys separate per user', async () => {
    charged = 0
    await pay('alice', 'shared', 1)
    const bob = await pay('bob', 'shared', 7)
    expect(bob.body).toEqual({ charged: 7 })
    expect(charged).toBe(8)
  })

  it('answers 422 when the same key is reused with a different body', async () => {
    await pay('carol', 'k2', 3)
    const res = await pay('carol', 'k2', 999)
    expect(res.status).toBe(422)
  })
})

describe('BUG-04: secrets in connection strings are not echoed', () => {
  const dsn = 'postgresql://app:S3cretPw@db.example.com:5432/app'

  const errorsOf = (fn: () => unknown): any[] => {
    try {
      fn()
    } catch (e: any) {
      return e.errors
    }
    throw new Error('expected a validation error')
  }

  it('hides the whole value of *_URL, *_URI and *_DSN fields', () => {
    const errors = errorsOf(() =>
      tex
        .env({ DATABASE_URL: tex.string({ min: 999 }) })
        .parse({ DATABASE_URL: dsn } as any)
    )
    expect(errors[0].received).toBe('[Redacted]')
  })

  it('masks the password of a URL in any field', () => {
    const errors = errorsOf(() =>
      tex.object({ link: tex.string({ max: 5 }) }).parse({ link: dsn })
    )
    expect(errors[0].received).not.toContain('S3cretPw')
    expect(errors[0].received).toContain('postgresql://app:***@db.example.com')
  })
})

describe('T-02: a handler that returns nothing still answers', () => {
  @Controller('/hang')
  class HangController {
    @Get('/undefined')
    nothing() {
      return undefined
    }

    @Get('/accepted')
    @HttpCode(202)
    accepted() {
      // no return
    }
  }

  const app = new App()
  app.registerControllers([HangController])
  app.registerFunctionalController(
    controller({
      empty: route.get('/empty', {
        async handle() {
          // no return
        },
      }),
    }),
    '/fn'
  )
  const client = createTestApp(app)

  it('class: answers 204', async () => {
    const res = await client.get('/hang/undefined')
    expect(res.status).toBe(204)
    expect(res.headers['content-type']).toBeUndefined()
  })

  it('class: keeps a status set with @HttpCode', async () => {
    const res = await client.get('/hang/accepted')
    expect(res.status).toBe(202)
  })

  it('functional: answers 204', async () => {
    const res = await client.get('/fn/empty')
    expect(res.status).toBe(204)
  })
})

describe('T-16: a rejection with null is a server error', () => {
  @Controller('/reject')
  class RejectController {
    @Get('/null')
    rejectNull() {
      return Promise.reject(null)
    }
  }

  const app = new App()
  app.registerControllers([RejectController])
  app.registerFunctionalController(
    controller({
      rejectNull: route.get('/null', {
        handle() {
          return Promise.reject(null)
        },
      }),
    }),
    '/fn-reject'
  )
  const client = createTestApp(app)

  it('class: 500', async () => {
    expect((await client.get('/reject/null')).status).toBe(500)
  })

  it('functional: 500', async () => {
    expect((await client.get('/fn-reject/null')).status).toBe(500)
  })
})

describe('T-07 / T-08 / T-18: route authorization', () => {
  @Controller('/auth')
  class AuthController {
    @Get('/report')
    @Permissions('report:read', 'report:export')
    report() {
      return { ok: true }
    }

    @Get('/admin')
    @Roles('admin')
    admin() {
      return { ok: true }
    }

    @Get('/open')
    @Public()
    @Roles('admin')
    open() {
      return { ok: true }
    }
  }

  let currentUser: any
  const app = new App()
  app.use((req: any, _res: any, next: any) => {
    req.user = currentUser
    next()
  })
  app.registerControllers([AuthController])
  app.registerFunctionalController(
    controller({
      report: route.get('/report', {
        permissions: ['report:read', 'report:export'],
        handle: () => ({ ok: true }),
      }),
    }),
    '/fn-auth'
  )
  const client = createTestApp(app)

  it('answers 401 with the standard envelope when nobody is signed in', async () => {
    currentUser = undefined
    const res = await client.get('/auth/admin')
    expect(res.status).toBe(401)
    expect(res.body.statusCode).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('requires every listed permission (class and functional)', async () => {
    currentUser = { permissions: ['report:read'] }
    expect((await client.get('/auth/report')).status).toBe(403)
    expect((await client.get('/fn-auth/report')).status).toBe(403)
    currentUser = { permissions: ['report:read', 'report:export'] }
    expect((await client.get('/auth/report')).status).toBe(200)
    expect((await client.get('/fn-auth/report')).status).toBe(200)
  })

  it('does not treat a role name as a permission', async () => {
    currentUser = { role: 'report:read', roles: ['report:export'] }
    expect((await client.get('/fn-auth/report')).status).toBe(403)
    expect((await client.get('/auth/report')).status).toBe(403)
  })

  it('ignores an isSuperAdmin field on the user', async () => {
    currentUser = { isSuperAdmin: true }
    const res = await client.get('/auth/admin')
    expect(res.status).toBe(403)
    expect(res.body.statusCode).toBe(403)
  })

  it('@Public() wins over @Roles', async () => {
    currentUser = undefined
    expect((await client.get('/auth/open')).status).toBe(200)
  })

  it('supports an explicit super-user rule', async () => {
    const app2 = new App({
      authorization: { superUser: (user) => user.role === 'owner' },
    })
    app2.use((req: any, _res: any, next: any) => {
      req.user = { role: 'owner' }
      next()
    })
    app2.registerControllers([AuthController])
    expect((await createTestApp(app2).get('/auth/report')).status).toBe(200)
  })
})

describe('T-11 / T-14: HEAD and 405', () => {
  @Controller('/health')
  class HealthController {
    @Get('/')
    health() {
      return { ok: true }
    }
  }

  const app = new App()
  app.registerControllers([HealthController])
  app.registerFunctionalController(
    controller({
      ping: route.get('/ping', { handle: () => ({ pong: true }) }),
    }),
    '/fn'
  )
  const client = createTestApp(app)

  it('answers HEAD from the GET route without a body', async () => {
    const res = await client.head('/health')
    expect(res.status).toBe(200)
    expect(res.text).toBe('')
    expect(String(res.headers['content-type'])).toContain('application/json')
  })

  it('answers a known path with the wrong method with 405 and Allow (class)', async () => {
    const res = await client.delete('/health')
    expect(res.status).toBe(405)
    expect(res.headers['allow']).toBe('GET, HEAD')
    expect(res.body.error.code).toBe('METHOD_NOT_ALLOWED')
  })

  it('answers 405 for functional routes too', async () => {
    const res = await client.post('/fn/ping')
    expect(res.status).toBe(405)
  })

  it('still answers 404 for an unknown path', async () => {
    expect((await client.delete('/nope')).status).toBe(404)
  })

  it('answers OPTIONS for a known path with 204', async () => {
    expect((await client.options('/health')).status).toBe(204)
  })
})

describe('T-10: security headers', () => {
  const build = (helmet: any) => {
    const app = new App({ helmet, docs: { enabled: true } } as any)
    app.get('/ping', () => ({ ok: true }))
    return createTestApp(app)
  }

  it('helmet sends a Content-Security-Policy by default', async () => {
    const res = await build({ enabled: true }).get('/ping')
    expect(String(res.headers['content-security-policy'])).toContain(
      "default-src 'self'"
    )
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('contentSecurityPolicy: false sends none', async () => {
    const res = await build({
      enabled: true,
      contentSecurityPolicy: false,
    }).get('/ping')
    expect(res.headers['content-security-policy']).toBeUndefined()
  })

  it('the /docs page sends a policy that allows its CDN assets', async () => {
    const app = new App({ helmet: { enabled: true } })
    mountDocumentation(app, {})
    const res = await createTestApp(app).get('/docs')
    expect(res.status).toBe(200)
    expect(String(res.headers['content-security-policy'])).toContain(
      'https://cdn.jsdelivr.net'
    )
  })
})

describe('T-22 / BUG-05: cron jobs are discovered once', () => {
  it('ignores the compiled copy of a job outside production', async () => {
    const dir = createTempDir('exis-cron-once-')
    const cronPath = path
      .join(__dirname, '../src/cron/manager')
      .replace(/\\/g, '/')
    const job = `
      const { cron } = require('${cronPath}')
      module.exports = cron({ name: 'cleanup', schedule: '0 0 * * *', run() {} })
    `
    writeTempFile(dir, 'src/cron/cleanup.js', job)
    writeTempFile(dir, '.exis/server/src/cron/cleanup.js', job)

    const app = new App()
    const warnings: string[] = []
    const warn = app.log.warn.bind(app.log)
    app.log.warn = ((...args: any[]) => {
      warnings.push(String(args[args.length - 1]))
      return warn(...(args as [any]))
    }) as any
    try {
      await app.autoMountRoutes(dir)
      expect(app.cron.has('cleanup')).toBe(true)
      expect(warnings.some((w) => w.includes('Overwriting'))).toBe(false)
    } finally {
      app.cron.stopAll()
      cleanupTempDir(dir)
    }
  })
})

// ─── Type-level checks (BUG-01, BUG-02, TS-1): fail `npm run typecheck` ─────
type Equal<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
    ? true
    : false
const assertType = <_T extends true>(): void => undefined

describe('BUG-01 / BUG-02: validator types', () => {
  const MODULES = ['ALL', 'EV', 'PV'] as const
  const query = tex.object({
    module: tex.enum(MODULES, { optional: true, default: 'ALL' }),
    page: tex.number({ default: 1 }),
    search: tex.string({ optional: true }),
    name: tex.string(),
  })

  it('accepts a readonly array in tex.enum', () => {
    expect(query.parse({ name: 'x' }).module).toBe('ALL')
  })

  it('types a field with a default as always present after parsing', () => {
    type Out = ResolveSchema<typeof query>
    assertType<Equal<Out['module'], 'ALL' | 'EV' | 'PV'>>()
    assertType<Equal<Out['page'], number>>()
    assertType<Equal<ResolveOutput<typeof query>, Out>>()
    // Optional without a default stays optional
    assertType<Equal<Out['search'], string | undefined>>()
  })

  it('lets a client omit fields that have a default', () => {
    type In = ResolveInput<typeof query>
    const minimal: In = { name: 'x' }
    expect(minimal.name).toBe('x')
    assertType<Equal<In['module'], 'ALL' | 'EV' | 'PV' | undefined>>()
    // @ts-expect-error name has no default, so it is required
    const missing: In = {}
    expect(missing).toEqual({})
  })
})

describe('T-19 / BUG-09: every decorator named in the docs exists', () => {
  it('exports each `@Name(` used in the decorator and router references', async () => {
    const fs = await import('node:fs')
    const decorators: Record<string, unknown> =
      await import('../src/decorators')
    const docsDir = path.join(__dirname, '../../../docs')
    const files = [
      'content/decorators.mdx',
      'reference/decorators.mdx',
      'reference/router.mdx',
      'reference/di.mdx',
    ]
    const missing: string[] = []
    let checked = 0
    for (const file of files) {
      const text = fs.readFileSync(path.join(docsDir, file), 'utf8')
      for (const [, name] of text.matchAll(/`@([A-Z][A-Za-z]+)\(/g)) {
        checked++
        if (!(name in decorators)) missing.push(`${file}: @${name}`)
      }
    }
    expect(checked).toBeGreaterThan(50)
    expect(missing).toEqual([])
  })
})

describe('T-23: validation logs show the mounted path', () => {
  it('includes the prefix of a functional controller', async () => {
    const app = new App()
    app.registerFunctionalController(
      controller({
        create: route.post('/user', {
          body: tex.object({ name: tex.string({ min: 3 }) }),
          handle: () => ({ ok: true }),
        }),
      }),
      '/fn'
    )
    let routePath: string | undefined
    app.onError((err: any) => {
      routePath = err.routePath
    })

    const res = await createTestApp(app).post('/fn/user', { name: 'x' })
    expect(res.status).toBe(400)
    // The validation log line is built from this
    expect(routePath).toBe('/fn/user')
  })
})

describe('T-26: test harness', () => {
  const app = new App()
  app.get('/echo', (req) => ({ query: req.query }))
  app.get('/never', () => new Promise(() => undefined))
  const client = createTestApp(app)

  it('.query() builds the query string', async () => {
    const res = await client.get('/echo').query({ page: 2, q: 'a b' })
    expect(res.body.query).toEqual({ page: '2', q: 'a b' })
  })

  it('fails a request that never answers instead of hanging the run', async () => {
    const started = Date.now()
    let message = ''
    try {
      await client.get('/never').timeout(200)
    } catch (err: any) {
      message = err.message
    }
    expect(message).toContain('GET /never did not respond within 200ms')
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('startTestServer() serves the app on a real socket', async () => {
    const server = await startTestServer(app)
    try {
      expect(server.port).toBeGreaterThan(0)
      const res = await server.request('/echo?x=1')
      expect(res.status).toBe(200)
      expect(((await res.json()) as any).query).toEqual({ x: '1' })
    } finally {
      await server.close()
    }
  })
})

describe('SEC-3: shared rate-limit store', () => {
  it('enforces one limit across two app instances that share a store', async () => {
    const store = new MemoryRateLimitStore()
    const build = () => {
      const app = new App()
      app.use(rateLimit({ max: 2, windowMs: 60000, store }))
      app.get('/login', () => ({ ok: true }))
      return createTestApp(app)
    }
    const a = build()
    const b = build()
    expect((await a.get('/login')).status).toBe(200)
    expect((await b.get('/login')).status).toBe(200)
    // Third hit from the same client on either instance is over the limit
    const third = await a.get('/login')
    expect(third.status).toBe(429)
    expect(third.body.error.code).toBe('RATE_LIMIT_EXCEEDED')
  })

  it('lets requests through when the store fails', async () => {
    const app = new App()
    app.use(
      rateLimit({
        store: {
          increment: () => Promise.reject(new Error('redis down')),
        },
      })
    )
    app.get('/ping', () => ({ ok: true }))
    expect((await createTestApp(app).get('/ping')).status).toBe(200)
  })
})

describe('ENT-4: liveness and readiness', () => {
  it('serves /_ready from the checks and the shutdown state', async () => {
    let dependencyUp = true
    const app = new App({
      healthcheck: { enabled: true, checks: [async () => dependencyUp] },
    })
    const client = createTestApp(app)

    expect((await client.get('/_ready')).status).toBe(200)

    dependencyUp = false
    const notReady = await client.get('/_ready')
    expect(notReady.status).toBe(503)
    expect(notReady.body.status).toBe('not_ready')

    dependencyUp = true
    app._shuttingDown = true
    expect((await client.get('/_ready')).body.status).toBe('shutting_down')
  })
})

describe('SEC-1: deny-by-default routes', () => {
  @Controller('/dd')
  class DenyController {
    @Get('/private')
    secret() {
      return { ok: true }
    }

    @Get('/open')
    @Public()
    open() {
      return { ok: true }
    }
  }

  it('requires a user on routes without a rule when defaultPolicy is authenticated', async () => {
    let user: any = undefined
    const app = new App({ authorization: { defaultPolicy: 'authenticated' } })
    app.use((req: any, _res: any, next: any) => {
      req.user = user
      next()
    })
    app.get('/health', () => ({ ok: true }))
    app.registerControllers([DenyController])
    const client = createTestApp(app)

    expect((await client.get('/dd/private')).status).toBe(401)
    expect((await client.get('/dd/open')).status).toBe(200)
    expect((await client.get('/health')).status).toBe(200)
    user = { id: '1' }
    expect((await client.get('/dd/private')).status).toBe(200)
  })

  it('keeps routes open by default', async () => {
    const app = new App()
    app.registerControllers([DenyController])
    expect((await createTestApp(app).get('/dd/private')).status).toBe(200)
  })
})

describe('ENT-3: request id on log lines', () => {
  it('binds the request id to req.log', async () => {
    const app = new App()
    app.get('/log', (req: any) => ({ bindings: req.log.bindings?.() ?? null }))
    const res = await createTestApp(app)
      .get('/log')
      .set('x-request-id', 'req-123')
    expect(res.body.bindings).toEqual({ requestId: 'req-123' })
  })
})
