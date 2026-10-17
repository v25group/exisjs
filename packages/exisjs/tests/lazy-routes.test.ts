import { App } from '../src/server/app'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createTestApp } from '../src/testing/client'
import { describe, it, expect, beforeEach, afterEach } from '../src/testing'

// Dev-mode lazy route loading (REPORTS.md 0.9.1 #1, #2, #3, #5)
describe('Lazy routes in development', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'exis-lazy-test-'))
    const httpDir = path.join(tmpDir, 'src', 'http')
    const routerPath = path
      .join(__dirname, '../src/router/index')
      .replace(/\\/g, '/')

    await fs.mkdir(path.join(httpDir, 'items'), { recursive: true })
    await fs.writeFile(
      path.join(httpDir, 'items', 'route.js'),
      `
      const { controller, route } = require('${routerPath}')
      exports.default = controller({
        one: route.get('/:id', { handle: ({ params }) => ({ id: params.id }) })
      })
      `
    )

    await fs.mkdir(path.join(httpDir, 'broken'), { recursive: true })
    await fs.writeFile(
      path.join(httpDir, 'broken', 'route.js'),
      `throw new Error('DATABASE_URL is missing')`
    )
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  const mount = async (options: any = {}) => {
    const app = new App({ env: 'development', server: 'node', ...options })
    const scanner = (app as any).routeScanner
    const original = scanner.mountRouteFile.bind(scanner)
    const calls: any[][] = []
    // A slow import widens the window between "placeholder gone" and "route mounted"
    scanner.mountRouteFile = async (...args: any[]) => {
      calls.push(args)
      await new Promise((r) => setTimeout(r, 50))
      return original(...args)
    }
    await scanner.autoMountRoutes(tmpDir)
    return { app, scanner, calls }
  }

  it('answers every concurrent first request from the real route', async () => {
    const { app, calls } = await mount()
    const client = createTestApp(app)

    const results = await Promise.all([
      client.get('/items/abc'),
      client.get('/items/abc'),
      client.get('/items/abc'),
    ])

    expect(results.map((r) => r.status)).toEqual([200, 200, 200])
    expect(results[0].body).toEqual({ id: 'abc' })
    expect(calls.filter((c) => c[0].includes('items')).length).toBe(1)
  })

  it('answers a route that fails to load with 500 and retries next time', async () => {
    const { app } = await mount()
    const client = createTestApp(app)

    const first = await client.get('/broken')
    expect(first.status).toBe(500)
    expect(first.body.error.message).toContain('DATABASE_URL is missing')

    const second = await client.get('/broken')
    expect(second.status).toBe(500)
  })

  it('mounts the module imported by the startup check instead of importing it again', async () => {
    const { app, calls } = await mount()
    await createTestApp(app).get('/items/abc')

    const itemsCall = calls.find((c) => c[0].includes('items'))!
    expect(itemsCall[2]).toBeDefined()
  })

  it('loads every route at startup with dev.lazyRoutes: false', async () => {
    const { app, scanner } = await mount({ dev: { lazyRoutes: false } })

    expect(
      scanner.lazyRoutes.get(path.resolve(tmpDir, 'src/http/items/route.js'))
        .loaded
    ).toBe(true)
    const res = await createTestApp(app).get('/items/abc')
    expect(res.status).toBe(200)
  })
})

// REPORTS.md 0.9.1 #4: no NODE_ENV must not mean development
describe('Default environment', () => {
  it('is production when NODE_ENV is not set', () => {
    const env = { ...process.env }
    delete env.NODE_ENV
    const configPath = path.join(__dirname, '../src/config/config.ts')
    const child = spawnSync(
      process.execPath,
      [
        ...process.execArgv.filter((a) => !a.startsWith('--test')),
        '-e',
        `console.log(require(${JSON.stringify(configPath)}).defaultConfig.env)`,
      ],
      { env, encoding: 'utf8' }
    )
    expect(child.stdout.trim()).toBe('production')
  })
})
