import fs from 'node:fs'
import path from 'node:path'
import { App } from '../src/server/app'
import { createTestApp } from '../src/testing/client'
import { isBoundaryFile, isRouteFile } from '../src/router/scanner/fs-scanner'
import { describe, it, expect, beforeEach, afterEach } from '../src/testing'
import { createTempDir, cleanupTempDir } from './helpers'

const routerPath = path
  .join(__dirname, '../src/router/index')
  .replace(/\\/g, '/')
const decoratorsPath = path
  .join(__dirname, '../src/decorators/index')
  .replace(/\\/g, '/')

const functional = (routePath: string) => `
const { controller, route } = require('${routerPath}')
exports.default = controller({
  main: route.get('${routePath}', { handle: () => 'ok' }),
})
`

describe('route and boundary file names', () => {
  it('accepts exact and named files, on either path separator', () => {
    for (const file of [
      'route.ts',
      'route.js',
      'users.route.ts',
      'src/http/users/route.ts',
      'src\\http\\users\\route.js',
      'src/http/users/users.route.js',
    ]) {
      expect(isRouteFile(file)).toBe(true)
    }
    for (const file of [
      'boundary.ts',
      'admin.boundary.js',
      'src/http/boundary.ts',
      'src\\http\\boundary.js',
    ]) {
      expect(isBoundaryFile(file)).toBe(true)
    }
  })

  it('rejects names that only end the same way', () => {
    for (const file of [
      'reroute.ts',
      'src/http/x/subroute.js',
      'route.test.ts',
      'route.d.ts',
      'users.route.d.ts',
    ]) {
      expect(isRouteFile(file)).toBe(false)
    }
    for (const file of ['myboundary.ts', 'src/http/x/myboundary.js']) {
      expect(isBoundaryFile(file)).toBe(false)
    }
  })
})

describe('route conflicts at startup', () => {
  let root: string
  let http: string

  const write = (relative: string, source: string) => {
    const file = path.join(http, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, source)
  }

  const start = async () => {
    const app = new App({ env: 'test', logger: false } as any)
    await app.autoMountRoutes(root)
    return app
  }

  const startError = async (): Promise<Error & { code?: string }> => {
    try {
      await start()
    } catch (err) {
      return err as Error
    }
    throw new Error('expected the server not to start')
  }

  beforeEach(() => {
    root = createTempDir('exis-route-conflicts-')
    http = path.join(root, 'src', 'http')
    fs.mkdirSync(http, { recursive: true })
  })

  afterEach(() => {
    cleanupTempDir(root)
  })

  it('does not load a file that only ends in route', async () => {
    write('x/reroute.js', functional('/'))
    write('y/y.route.js', functional('/'))

    const app = await start()

    const paths = app.getRoutes().map((r) => r.path)
    expect(paths.some((p) => p.startsWith('/x'))).toBe(false)
    expect(paths.some((p) => p.startsWith('/y'))).toBe(true)
  })

  it('refuses two route files in one folder, naming both', async () => {
    write('health/health.route.js', functional('/'))
    write('health/extra.route.js', functional('/other'))

    const err = await startError()

    expect(err.code).toBe('ROUTE_CONFLICT')
    expect(err.message).toContain('health.route.js')
    expect(err.message).toContain('extra.route.js')
  })

  it('refuses the same method and path from two folders', async () => {
    write('a/a.route.js', functional('/shared'))
    write('a/shared/shared.route.js', functional('/'))

    const err = await startError()

    expect(err.code).toBe('ROUTE_CONFLICT')
    expect(err.message).toContain('a.route.js')
    expect(err.message).toContain('shared.route.js')
  })

  it('treats differently named params as the same path', async () => {
    write('users/[id]/id.route.js', functional('/'))
    write('users/[slug]/slug.route.js', functional('/'))

    const err = await startError()

    expect(err.code).toBe('ROUTE_CONFLICT')
    expect(err.message).toContain('id.route.js')
    expect(err.message).toContain('slug.route.js')
  })

  it('refuses a duplicate inside one route file', async () => {
    write(
      'a/route.js',
      `
const { controller, route } = require('${routerPath}')
exports.default = controller({
  one: route.get('/', { handle: () => 'one' }),
  two: route.get('/', { handle: () => 'two' }),
})
`
    )

    expect((await startError()).code).toBe('ROUTE_CONFLICT')
  })

  it('refuses a duplicate between class controllers and names the files', async () => {
    const oop = (routePath: string) => `
const { Controller, Get } = require('${decoratorsPath}')
class C { handle() { return 'ok' } }
Get('${routePath}')(C.prototype, 'handle', Object.getOwnPropertyDescriptor(C.prototype, 'handle'))
Controller()(C)
exports.default = C
`
    write('a/a.route.js', oop('/shared'))
    write('a/shared/s.route.js', oop('/'))

    const err = await startError()

    expect(err.code).toBe('ROUTE_CONFLICT')
    expect(err.message).toContain('a.route.js')
    expect(err.message).toContain('s.route.js')
  })

  it('refuses a file route that collides with one registered in code', async () => {
    write('a/a.route.js', functional('/'))
    const app = new App({ env: 'test', logger: false } as any)
    app.get('/a', () => 'code')

    let message = ''
    await app.autoMountRoutes(root).catch((err: Error) => {
      message = err.message
    })

    expect(message).toContain('registered in code')
    expect(message).toContain('a.route.js')
  })

  it('leaves different methods, paths and hosts alone', async () => {
    write('a/a.route.js', functional('/'))
    write(
      'b/b.route.js',
      `
const { controller, route } = require('${routerPath}')
exports.default = controller({
  list: route.get('/', { handle: () => 'get' }),
  create: route.post('/', { handle: () => 'post' }),
  one: route.get('/:id', { handle: () => 'param' }),
  fixed: route.get('/static', { handle: () => 'static' }),
})
`
    )

    const app = await start()
    const res = await createTestApp(app).get('/b/static')

    expect(res.status).toBe(200)
  })

  it('refuses two boundaries in one folder, naming both', async () => {
    write('a/a.route.js', functional('/'))
    write('a/boundary.js', 'exports.config = {}')
    write('a/admin.boundary.js', 'exports.config = {}')

    const err = await startError()

    expect(err.message).toContain('boundary.js')
    expect(err.message).toContain('admin.boundary.js')
  })

  it('still loads a single named boundary', async () => {
    write('a/a.route.js', functional('/'))
    write(
      'a/admin.boundary.js',
      `exports.config = { headers: { 'x-named': 'yes' } }`
    )

    const app = await start()
    const res = await createTestApp(app).get('/a')

    expect(res.status).toBe(200)
    expect(res.headers['x-named']).toBe('yes')
  })

  describe('in development, where files load on first request', () => {
    const startDev = async () => {
      const app = new App({ env: 'development', logger: false } as any)
      await app.autoMountRoutes(root)
      return app
    }

    it('fails loading every route on a conflict, naming both files', async () => {
      write('a/a.route.js', functional('/shared'))
      write('a/shared/shared.route.js', functional('/'))

      const app = await startDev()

      let err: any
      await app.routeScanner.loadAllRoutes().catch((e: unknown) => {
        err = e
      })
      expect(err?.code).toBe('ROUTE_CONFLICT')
      expect(err.message).toContain('a.route.js')
      expect(err.message).toContain('shared.route.js')
    })

    it('refuses two route files in one folder when it starts', async () => {
      write('a/a.route.js', functional('/'))
      write('a/b.route.js', functional('/other'))

      let err: any
      await startDev().catch((e: unknown) => {
        err = e
      })
      expect(err?.code).toBe('ROUTE_CONFLICT')
    })
  })
})
