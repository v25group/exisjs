import * as fs from 'node:fs'
import * as path from 'node:path'
import * as http from 'node:http'
import { App } from '../src/server/app'
import { writeTempFile, cleanupTempDir } from './helpers'

// Helper to make HTTP requests
function request(
  server: ReturnType<App['listen']>,
  options: { method?: string; path?: string } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const address = server.address() as { port: number }
    const { method = 'GET', path = '/' } = options

    const req = http.request(
      { hostname: '127.0.0.1', port: address.port, path, method, agent: false },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          let parsed: unknown
          try {
            parsed = JSON.parse(data)
          } catch {
            parsed = data
          }
          resolve({
            status: res.statusCode!,
            body: parsed as Record<string, unknown>,
          })
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

// ─── Auto-Mount Tests ─────────────────────────────────────────────────────────

describe('App create & autoMountRoutes', () => {
  let tmpDir: string
  let app: App
  let server: ReturnType<App['listen']>

  beforeAll(async () => {
    tmpDir = path.join(__dirname, '.tmp-automount-' + Date.now())
    fs.mkdirSync(tmpDir, { recursive: true })

    const routerPath = path
      .join(__dirname, '../src/router/router')
      .replace(/\\/g, '/')

    // Create mock routes in src/api structure
    writeTempFile(
      tmpDir,
      'src/http/users/route.js',
      `
      const { Router } = require('${routerPath}')
      const router = new Router()
      router.get('/', (req, res) => res.json({ msg: 'users root' }))
      router.get('/profile', (req, res) => res.json({ msg: 'users profile' }))
      exports.router = router
      `
    )

    writeTempFile(
      tmpDir,
      'src/http/posts/[id]/route.js',
      `
      const { Router } = require('${routerPath}')
      const router = new Router()
      router.get('/', (req, res) => res.json({ id: req.params.id }))
      module.exports = router
      `
    )

    writeTempFile(
      tmpDir,
      'src/http/v1/admin/route.js',
      `
      const { Router } = require('${routerPath}')
      const router = new Router()
      router.get('/', (req, res) => res.json({ msg: 'admin root' }))
      module.exports = router
      `
    )

    writeTempFile(
      tmpDir,
      'src/http/(marketing)/about/route.js',
      `
      const { Router } = require('${routerPath}')
      const router = new Router()
      router.get('/', (req, res) => res.json({ page: 'about us' }))
      module.exports = router
      `
    )

    writeTempFile(
      tmpDir,
      'src/http/docs/[...slug]/route.js',
      `
      const { Router } = require('${routerPath}')
      const router = new Router()
      router.get('/', (req, res) => res.json({ slug: req.params.slug }))
      module.exports = router
      `
    )

    // Non-route file (should be ignored)
    writeTempFile(tmpDir, 'src/http/users/service.ts', 'export const a = 1')

    // Create an empty config so it doesn't fail
    writeTempFile(tmpDir, 'exis.config.ts', 'export default {}')

    app = new App({
      logger: true,
      cors: false,
      helmet: false,
    })

    // Auto mount the temp directory via public create method
    await app.create(tmpDir)

    server = app.listen({ port: 0, host: '127.0.0.1' })
    await new Promise<void>((r) => server.on('listening', r))
  })

  afterAll(async () => {
    await app.close()
    cleanupTempDir(tmpDir)
  })

  it('mounts root directory paths properly', async () => {
    const res1 = await request(server, { path: '/users' })
    expect(res1.status).toBe(200)
    expect(res1.body).toEqual({ msg: 'users root' })

    const res2 = await request(server, { path: '/users/profile' })
    expect(res2.status).toBe(200)
    expect(res2.body).toEqual({ msg: 'users profile' })
  })

  it('converts bracket syntax to dynamic parameters', async () => {
    const res = await request(server, { path: '/posts/123' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: '123' })
  })

  it('ignores (groupName) directories in the URL path', async () => {
    // /api/(marketing)/about -> /api/about
    const res = await request(server, { path: '/about' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ page: 'about us' })
  })

  it('handles [...slug] catch-all parameters', async () => {
    // /api/docs/[...slug] -> /api/docs/*slug
    const res = await request(server, {
      path: '/docs/exis/routing/advanced',
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ slug: 'exis/routing/advanced' })
  })

  it('only mounts .ts and .js route files', async () => {
    const res = await request(server, { path: '/v1/admin' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ msg: 'admin root' })
  })

  it('ignores non-route files', async () => {
    const res = await request(server, { path: '/users/service' })
    expect(res.status).toBe(404)
  })
})

// ─── Lifecycle Tests ──────────────────────────────────────────────────────────

describe('App Lifecycle', () => {
  it('listen accepts just a port number', async () => {
    const app = new App({ logger: false })
    const server = app.listen(0)
    await new Promise<void>((r) => server.on('listening', r))
    expect(server.listening).toBe(true)
    await app.close()
  })

  it('listen accepts options with callback', async () => {
    const app = new App({ logger: false })
    await new Promise<void>((r) => {
      app.listen({ port: 0, host: '127.0.0.1', onListen: () => r() })
    })
    await app.close()
  })

  it('close handles already closed server safely', async () => {
    const app = new App({ logger: false })
    const server = app.listen(0)
    await new Promise<void>((r) => server.on('listening', r))
    await app.close()
    // Closing again shouldn't throw or should be handled
    try {
      await app.close()
    } catch (e) {
      // Ignored
    }
  })

  it('executes shutdown hooks registered via onShutdown()', async () => {
    const app = new App({ logger: false })
    const server = app.listen(0)
    await new Promise<void>((r) => server.on('listening', r))

    const hook1 = jest.fn()
    const hook2 = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    app.onShutdown(hook1).onShutdown(hook2)

    await app.close()

    expect(hook1).toHaveBeenCalled()
    expect(hook2).toHaveBeenCalled()
  })

  it('force terminates active connections on shutdown timeout', async () => {
    const app = new App({ logger: false })
    let reqStarted: () => void
    const reqPromise = new Promise<void>((r) => (reqStarted = r))

    app.get('/', async (req, res) => {
      reqStarted()
      // keep connection open infinitely
      await new Promise(() => {})
    })

    const server = app.listen(0)
    await new Promise<void>((r) => server.on('listening', r))

    // Initiate an active connection that will never close
    request(server, { path: '/' }).catch(() => {})

    // Wait until the request actually hits the server
    await reqPromise

    const start = Date.now()
    // Trigger close with an extremely short timeout
    await app.close(50)
    const end = Date.now()

    // Should resolve forcibly near ~50ms, not hang infinitely
    expect(end - start).toBeGreaterThanOrEqual(40)
    expect(end - start).toBeLessThan(1000)
  })

  it('emits close event on the underlying http.Server', async () => {
    const app = new App({ logger: false })
    const server = app.listen(0)
    await new Promise<void>((r) => server.on('listening', r))

    const closeListener = jest.fn()
    server.on('close', closeListener)

    await app.close()

    expect(closeListener).toHaveBeenCalled()
  })
})
