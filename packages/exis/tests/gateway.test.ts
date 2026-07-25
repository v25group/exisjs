import { App } from '../src/server/app'
import { defineGateway, controller, route } from '../src/exports/route'
import path from 'node:path'
import fs from 'node:fs/promises'
import request from 'supertest'
import os from 'node:os'

describe('Gateway & Inline Config', () => {
  let app: App
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'exis-gateway-test-'))

    // Create src/http structure
    const httpDir = path.join(tmpDir, 'src', 'http')
    await fs.mkdir(httpDir, { recursive: true })

    const routerPath = path
      .join(__dirname, '../src/exports/route')
      .replace(/\\/g, '/')

    // Root Gateway
    await fs.writeFile(
      path.join(httpDir, 'gateway.js'),
      `
      const { defineGateway } = require('${routerPath}')
      exports.default = defineGateway({
        headers: { 'X-Root-Gateway': 'true' },
        cors: { origin: 'https://root.com' }
      })
      `
    )

    // Sub directory
    const subDir = path.join(httpDir, 'api')
    await fs.mkdir(subDir)

    // Sub Gateway
    await fs.writeFile(
      path.join(subDir, 'gateway.js'),
      `
      const { defineGateway } = require('${routerPath}')
      exports.default = defineGateway({
        headers: { 'X-Sub-Gateway': 'true' },
        middleware: [
          (req, res, next) => {
            res.setHeader('X-Sub-Middleware', 'ran')
            next()
          }
        ]
      })
      `
    )

    // Route with inline config
    await fs.writeFile(
      path.join(subDir, 'route.js'),
      `
      const { controller, route } = require('${routerPath}')
      exports.config = {
        headers: { 'X-Inline-Config': 'true' }
      }
      exports.default = controller({
        main: route.get('/', {
          handle: ({ res }) => res.json({ ok: true })
        })
      })
      `
    )

    app = new App({
      env: 'production', // Skip lazy loading in tests
    })
    app.apiDir = httpDir

    // Scan and mount manually to mimic autoMount since we are testing internals
    // @ts-expect-error private method access in tests
    const routes = await app.scanDirectory(httpDir)
    for (const { filePath, routePath } of routes) {
      if (filePath.endsWith('route.js')) {
        await app.mountRouteFile(filePath, routePath)
      }
    }
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('cascades gateways and inline config', async () => {
    // The route is at /api
    const res = await request((app as any).server).get('/api')

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // Assert headers
    expect(res.headers['x-root-gateway']).toBe('true')
    expect(res.headers['x-sub-gateway']).toBe('true')
    expect(res.headers['x-inline-config']).toBe('true')
    expect(res.headers['x-sub-middleware']).toBe('ran')
    expect(res.headers['access-control-allow-origin']).toBe('https://root.com')
  })
})
