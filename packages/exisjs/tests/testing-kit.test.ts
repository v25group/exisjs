import fs from 'node:fs'
import path from 'node:path'
import { App } from '../src/server/app'
import { controller, route } from '../src/router/index'
import { csrf } from '../src/middleware/security'
import {
  auditRoutes,
  createTestApp,
  describe,
  expect,
  getRoutes,
  it,
} from '../src/testing'
import { auditRouteTable, loadRouteAudit } from '../src/router/route-audit'
import { createTempDir, cleanupTempDir } from './helpers'

const SECRET = 'a-secret-that-is-at-least-32-characters-long'

function cookieApp() {
  const app = new App({ env: 'test', logger: false } as any)
  app.post('/login', (_req: any, res: any) => {
    res.cookie('session', 'abc', { path: '/' })
    res.cookie('scoped', 'xyz', { path: '/admin' })
    res.cookie('short', 'gone', { path: '/', maxAge: 1 })
    return { ok: true }
  })
  app.post('/logout', (_req: any, res: any) => {
    res.cookie('session', '', { path: '/', maxAge: 0 })
    return { ok: true }
  })
  const echo = (req: any) => ({ cookie: req.get('cookie') ?? null })
  app.get('/me', echo)
  app.get('/admin/me', echo)
  return app
}

describe('browser()', () => {
  it('keeps cookies between requests and sends them back', async () => {
    const browser = createTestApp(cookieApp()).browser()

    await browser.post('/login')
    const res = await browser.get('/me')

    expect(res.body.cookie).toContain('session=abc')
    expect(browser.cookie('session')).toBe('abc')
  })

  it('sends a cookie only under its path', async () => {
    const browser = createTestApp(cookieApp()).browser()

    await browser.post('/login')

    expect((await browser.get('/me')).body.cookie).not.toContain('scoped')
    expect((await browser.get('/admin/me')).body.cookie).toContain('scoped=xyz')
  })

  it('forgets a cookie the server expires', async () => {
    const browser = createTestApp(cookieApp()).browser()

    await browser.post('/login')
    await browser.post('/logout')

    expect(browser.cookie('session')).toBeUndefined()
    expect((await browser.get('/me')).body.cookie ?? '').not.toContain(
      'session='
    )
  })

  it('reads a cookie after one with an Expires date', async () => {
    const app = new App({ env: 'test', logger: false } as any)
    app.post('/login', (_req: any, res: any) => {
      res.cookie('dated', 'a', { expires: new Date(Date.now() + 60000) })
      res.cookie('next', 'b')
      return { ok: true }
    })
    const browser = createTestApp(app).browser()

    await browser.post('/login')

    expect(browser.cookie('dated')).toBe('a')
    expect(browser.cookie('next')).toBe('b')
  })

  it('keeps each browser separate, like two users', async () => {
    const api = createTestApp(cookieApp())
    const first = api.browser()
    const second = api.browser()

    await first.post('/login')

    expect(second.cookie('session')).toBeUndefined()
    expect((await second.get('/me')).body.cookie).toBeNull()
  })

  it('leaves a cookie header the test set itself', async () => {
    const browser = createTestApp(cookieApp()).browser()

    await browser.post('/login')
    const res = await browser.get('/me').set('cookie', 'mine=1')

    expect(res.body.cookie).toBe('mine=1')
  })

  it('clearCookies() starts over', async () => {
    const browser = createTestApp(cookieApp()).browser()

    await browser.post('/login')
    browser.clearCookies()

    expect((await browser.get('/me')).body.cookie).toBeNull()
  })

  describe('with csrf()', () => {
    function csrfApp(options: Record<string, string> = {}) {
      const app = new App({ env: 'test', logger: false } as any)
      app.use(csrf({ secret: SECRET, ...options }))
      app.get('/csrf', () => ({ ok: true }))
      app.post('/save', () => ({ saved: true }))
      return app
    }

    it('fails a state-changing request without a token, as a real browser would', async () => {
      const res = await createTestApp(csrfApp()).post('/save')

      expect(res.status).toBe(403)
    })

    it('sends the token back once a response has set the cookie', async () => {
      const browser = createTestApp(csrfApp()).browser()

      await browser.get('/csrf')
      const res = await browser.post('/save')

      expect(res.status).toBe(200)
      expect(res.body.saved).toBe(true)
    })

    it('fetches the token first with csrfPath', async () => {
      const browser = createTestApp(csrfApp()).browser({ csrfPath: '/csrf' })

      const res = await browser.post('/save')

      expect(res.status).toBe(200)
    })

    it('does not send the token on safe methods', async () => {
      const app = csrfApp()
      app.get('/header', (req: any) => ({
        token: req.get('x-csrf-token') ?? null,
      }))
      const browser = createTestApp(app).browser()

      await browser.get('/csrf')
      const res = await browser.get('/header')

      expect(res.body.token).toBeNull()
    })

    it('supports custom cookie and header names', async () => {
      const browser = createTestApp(
        csrfApp({ cookieName: 'xsrf', headerName: 'x-xsrf' })
      ).browser({
        csrfCookie: 'xsrf',
        csrfHeader: 'x-xsrf',
        csrfPath: '/csrf',
      })

      expect((await browser.post('/save')).status).toBe(200)
    })
  })
})

describe('route audit', () => {
  describe('auditRouteTable', () => {
    const routes = [
      { method: 'GET', path: '/health/', access: 'public' },
      { method: 'GET', path: '/me', access: '-' },
      { method: 'GET', path: '/leads', access: 'perms: leads.read' },
      { method: 'POST', path: '/admin', access: 'roles: admin' },
    ]

    it('reports open routes nobody reviewed', () => {
      expect(auditRouteTable(routes, [])).toEqual({
        unreviewed: ['GET /health', 'GET /me'],
        stale: [],
      })
    })

    it('passes once they are on the list', () => {
      expect(auditRouteTable(routes, ['GET /health', 'GET /me'])).toEqual({
        unreviewed: [],
        stale: [],
      })
    })

    it('reports entries that no longer match a route', () => {
      const result = auditRouteTable(routes, [
        'GET /health',
        'GET /me',
        'GET /removed',
      ])

      expect(result.stale).toEqual(['GET /removed'])
    })

    it('counts a route with no access information as open', () => {
      expect(
        auditRouteTable([{ method: 'GET', path: '/x' }], []).unreviewed
      ).toEqual(['GET /x'])
    })
  })

  describe('loadRouteAudit', () => {
    let root: string

    const withFile = (content: string, run: () => void) => {
      root = createTempDir('exis-route-audit-')
      try {
        fs.writeFileSync(path.join(root, 'routes-audit.json'), content)
        run()
      } finally {
        cleanupTempDir(root)
      }
    }

    it('treats a missing file as nothing reviewed', () => {
      root = createTempDir('exis-route-audit-')
      expect(loadRouteAudit(root)).toEqual([])
      cleanupTempDir(root)
    })

    it('reads the list', () => {
      withFile('{ "open": ["GET /health"] }', () => {
        expect(loadRouteAudit(root)).toEqual(['GET /health'])
      })
    })

    it('names the file when it is not JSON', () => {
      withFile('{ nope', () => {
        expect(() => loadRouteAudit(root)).toThrow(/routes-audit\.json/)
      })
    })

    it('refuses the wrong shape', () => {
      for (const content of ['[]', '{"open":"x"}', '{"open":[1]}', 'null']) {
        withFile(content, () => {
          expect(() => loadRouteAudit(root)).toThrow(/routes-audit\.json/)
        })
      }
    })
  })

  describe('against an app', () => {
    function mounted() {
      const app = new App({
        env: 'test',
        logger: false,
        authorization: { defaultPolicy: 'authenticated' },
      } as any)
      const router = app.routeScanner.compileFunctionalController(
        controller({
          health: route.get('/health', {
            public: true,
            handle: () => ({ ok: true }),
          }),
          me: route.get('/me', { handle: () => ({ me: true }) }),
          lead: route.get('/leads/:id', {
            permissions: ['leads.read'],
            handle: () => ({ lead: true }),
          }),
          create: route.post('/leads', {
            permissions: ['leads.write'],
            handle: () => ({ created: true }),
          }),
        })
      )
      app.routeScanner.mountRouteWithSource('/', router, 'src/http/route.ts')
      return app
    }

    it('getRoutes lists each route with its access', async () => {
      const routes = await getRoutes(mounted())

      expect(routes.find((r) => r.path === '/leads/:id')).toEqual({
        method: 'GET',
        path: '/leads/:id',
        access: 'perms: leads.read',
        sourceFile: 'src/http/route.ts',
      })
      expect(routes.find((r) => r.path === '/health')?.access).toBe('public')
    })

    it('createTestApp().routes() is the same list', async () => {
      const app = mounted()

      expect(await createTestApp(app).routes()).toEqual(await getRoutes(app))
    })

    it('passes when open routes are reviewed and the rest refuse anonymous callers', async () => {
      const result = await auditRoutes(mounted(), {
        open: ['GET /health', 'GET /me'],
      })

      expect(result).toEqual({
        unreviewed: [],
        stale: [],
        unprotected: [],
      })
    })

    it('reports an unreviewed route', async () => {
      const result = await auditRoutes(mounted(), { open: ['GET /health'] })

      expect(result.unreviewed).toEqual(['GET /me'])
    })

    it('reports a route that declares a rule but still answers anonymous callers', async () => {
      const app = new App({ env: 'test', logger: false } as any)
      // Registered in code with a rule the router never enforces
      const router = app.routeScanner.compileFunctionalController(
        controller({
          leak: route.get('/leak', {
            permissions: ['secret.read'],
            handle: () => ({ leaked: true }),
          }),
        })
      )
      for (const r of router.getRoutes()) {
        delete (r.schema as any).authorize
        r.handlers = [() => ({ leaked: true })]
      }
      app.routeScanner.mountRouteWithSource('/', router, 'src/http/route.ts')

      const result = await auditRoutes(app, { open: [] })

      expect(result.unprotected).toEqual([{ route: 'GET /leak', status: 200 }])
    })
  })
})
