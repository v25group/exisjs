import { App } from '../src/server/app'
import { defineBoundary, controller, route } from '../src/router/index'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createTestApp } from '../src/testing/client'
import { describe, it, expect, beforeEach, afterEach, ex } from '../src/testing'
import os from 'node:os'

describe('Boundary & Enhanced Pipeline', () => {
  let app: App
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'exis-boundary-test-'))

    // Create src/http structure
    const httpDir = path.join(tmpDir, 'src', 'http')
    await fs.mkdir(httpDir, { recursive: true })

    const routerPath = path
      .join(__dirname, '../src/router/index')
      .replace(/\\/g, '/')

    // Root Boundary: config + named middleware + wrapper function
    await fs.writeFile(
      path.join(httpDir, 'boundary.js'),
      `
      const { defineBoundary } = require('${routerPath}')

      exports.config = defineBoundary({
        headers: { 'X-Root-Boundary': 'true' },
        cors: { origin: 'https://boundary.com' }
      })

      // Auto-detected named middleware
      exports.logStep = function(req, res, next) {
        res.setHeader('X-Boundary-Middleware', 'ran')
        next()
      }

      // Auto-detected pipeline wrapper around routes
      exports.default = async function(ctx, next) {
        ctx.res.setHeader('X-Wrapper-Before', 'yes')
        const data = await next()
        return { wrapped: true, inner: data }
      }
      `
    )

    // Sub directory
    const subDir = path.join(httpDir, 'users')
    await fs.mkdir(subDir)

    // Sub Boundary
    await fs.writeFile(
      path.join(subDir, 'boundary.js'),
      `
      const { defineBoundary } = require('${routerPath}')
      exports.config = defineBoundary({
        headers: { 'X-Sub-Boundary': 'true' }
      })
      `
    )

    // Route in subDir
    await fs.writeFile(
      path.join(subDir, 'route.js'),
      `
      const { controller, route } = require('${routerPath}')
      exports.default = controller({
        main: route.get('/', {
          handle: () => ({ user: 'Alice' })
        })
      })
      `
    )

    app = new App({
      env: 'production',
      server: 'node',
    })
    app.apiDir = httpDir

    const routes = await (app as any).routeScanner.scanDirectory(httpDir)
    for (const { filePath, routePath } of routes) {
      if (filePath.endsWith('route.js')) {
        await (app as any).routeScanner.mountRouteFile(filePath, routePath)
      }
    }
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('runs boundary config, named middlewares, and pipeline wrapper correctly', async () => {
    const res = await createTestApp(app).get('/users')

    expect(res.status).toBe(200)
    expect(res.headers['x-root-boundary']).toBe('true')
    expect(res.headers['x-sub-boundary']).toBe('true')
    expect(res.headers['x-boundary-middleware']).toBe('ran')
    expect(res.headers['x-wrapper-before']).toBe('yes')
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://boundary.com'
    )

    // Verify response wrapper: { wrapped: true, inner: { user: 'Alice' } }
    expect(res.body.wrapped).toBe(true)
    expect(res.body.inner.user).toBe('Alice')
  })
  it('ignores legacy gateway files and only loads boundary files', async () => {
    const legacyDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'exis-gateway-ignore-test-')
    )

    try {
      const httpDir = path.join(legacyDir, 'src', 'http')
      await fs.mkdir(httpDir, { recursive: true })

      const routerPath = path
        .join(__dirname, '../src/router/index')
        .replace(/\\/g, '/')

      await fs.writeFile(
        path.join(httpDir, 'gateway.js'),
        `
        exports.mutatesResponse = function(req, res, next) {
          res.setHeader('X-Legacy-Gateway', 'ran')
          next()
        }
        `
      )

      await fs.writeFile(
        path.join(httpDir, 'route.js'),
        `
        const { controller, route } = require('${routerPath}')
        exports.default = controller({
          main: route.get('/', {
            handle: () => ({ ok: true })
          })
        })
        `
      )

      const legacyApp = new App({
        env: 'production',
        server: 'node',
      })
      const warnSpy = ex.spyOn(legacyApp.log, 'warn')

      await (legacyApp as any).routeScanner.mountRouteFile(
        path.join(httpDir, 'route.js'),
        '/'
      )

      const res = await createTestApp(legacyApp).get('/')

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.headers['x-legacy-gateway']).toBeUndefined()
      expect(warnSpy).toHaveBeenCalled()
      const warningMessage = warnSpy.mock.calls.some(
        (call: any) =>
          typeof call.arguments[0] === 'string' &&
          call.arguments[0].includes('Found deprecated') &&
          call.arguments[0].includes('boundary.ts')
      )
      expect(warningMessage).toBe(true)
      warnSpy.mockRestore()
    } finally {
      await fs.rm(legacyDir, { recursive: true, force: true })
    }
  })

  it('supports plural "middlewares" in controllers and boundaries', async () => {
    const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'exis-plural-mid-'))
    try {
      const httpDir = path.join(testDir, 'src', 'http')
      await fs.mkdir(httpDir, { recursive: true })
      const routerPath = path
        .join(__dirname, '../src/router/index')
        .replace(/\\/g, '/')

      await fs.writeFile(
        path.join(httpDir, 'boundary.js'),
        `
        const { defineBoundary } = require('${routerPath}')
        exports.config = defineBoundary({
          middlewares: [
            (req, res, next) => {
              res.setHeader('X-Boundary-Plural', 'yes')
              next()
            }
          ]
        })
        `
      )

      await fs.writeFile(
        path.join(httpDir, 'route.js'),
        `
        const { controller, route } = require('${routerPath}')
        exports.default = controller({
          middlewares: [
            (req, res, next) => {
              res.setHeader('X-Controller-Plural', 'yes')
              next()
            }
          ],
          testRoute: route.get('/hello', {
            middlewares: [
              (req, res, next) => {
                res.setHeader('X-Route-Plural', 'yes')
                next()
              }
            ],
            handle: () => ({ hello: 'world' })
          })
        })
        `
      )

      const testApp = new App({ env: 'production', server: 'node' })
      testApp.apiDir = httpDir
      await (testApp as any).routeScanner.mountRouteFile(
        path.join(httpDir, 'route.js'),
        '/'
      )

      const res = await createTestApp(testApp).get('/hello')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ hello: 'world' })
      expect(res.headers['x-boundary-plural']).toBe('yes')
      expect(res.headers['x-controller-plural']).toBe('yes')
      expect(res.headers['x-route-plural']).toBe('yes')
    } finally {
      await fs.rm(testDir, { recursive: true, force: true })
    }
  })
})
