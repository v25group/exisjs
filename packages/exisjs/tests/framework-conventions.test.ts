import { App } from '../src/server/app'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createTestApp } from '../src/testing/client'
import { describe, it, expect, beforeEach, afterEach } from '../src/testing'
import os from 'node:os'

describe('Framework Conventions: src/http/error.ts & Boundary Hooks', () => {
  let app: App
  let tmpDir: string
  const routerPath = path
    .join(__dirname, '../src/router/index')
    .replace(/\\/g, '/')
  const decoratorsPath = path
    .join(__dirname, '../src/decorators/index')
    .replace(/\\/g, '/')

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'exis-framework-conventions-')
    )
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  describe('src/http/error.ts (Framework Exception Handler)', () => {
    it('automatically discovers and mounts src/http/error.ts to format unhandled exceptions', async () => {
      const httpDir = path.join(tmpDir, 'src', 'http')
      await fs.mkdir(httpDir, { recursive: true })

      // Create src/http/error.js
      await fs.writeFile(
        path.join(httpDir, 'error.js'),
        `
        exports.onError = function(err, req, res) {
          res.status(500).json({
            handledBy: 'src/http/error.ts',
            errorMessage: err.message,
            url: req.path
          })
        }
        `
      )

      // Create route that throws an error
      await fs.writeFile(
        path.join(httpDir, 'route.js'),
        `
        const { controller, route } = require('${routerPath}')
        exports.default = controller({
          fail: route.get('/fail', {
            async handle() {
              throw new Error('Database connection failed')
            }
          })
        })
        `
      )

      app = new App()
      await app.autoMountRoutes(tmpDir)

      const res = await createTestApp(app).get('/fail')
      expect(res.status).toBe(500)
      expect(res.body.handledBy).toBe('src/http/error.ts')
      expect(res.body.errorMessage).toBe('Database connection failed')
      expect(res.body.url).toBe('/fail')
    })

    it('supports error.ts returning an object payload directly', async () => {
      const httpDir = path.join(tmpDir, 'src', 'http')
      await fs.mkdir(httpDir, { recursive: true })

      await fs.writeFile(
        path.join(httpDir, 'error.js'),
        `
        exports.default = function(err, req, res) {
          res.status(400)
          return {
            customError: true,
            msg: err.message
          }
        }
        `
      )

      await fs.writeFile(
        path.join(httpDir, 'route.js'),
        `
        const { controller, route } = require('${routerPath}')
        exports.default = controller({
          boom: route.get('/boom', {
            async handle() {
              throw new Error('Invalid payload')
            }
          })
        })
        `
      )

      app = new App()
      await app.autoMountRoutes(tmpDir)

      const res = await createTestApp(app).get('/boom')
      expect(res.status).toBe(400)
      expect(res.body.customError).toBe(true)
      expect(res.body.msg).toBe('Invalid payload')
    })
  })

  describe('boundary.ts beforeHandle & afterHandle hooks', () => {
    it('executes beforeHandle to allow or short-circuit requests', async () => {
      const httpDir = path.join(tmpDir, 'src', 'http')
      const apiDir = path.join(httpDir, 'api')
      await fs.mkdir(apiDir, { recursive: true })

      await fs.writeFile(
        path.join(apiDir, 'boundary.js'),
        `
        const { defineBoundary } = require('${routerPath}')
        exports.config = defineBoundary({
          beforeHandle(req, res) {
            if (req.headers['x-admin-key'] !== 'secret') {
              res.status(401).json({ error: 'Unauthorized boundary access' })
              return false
            }
            res.setHeader('X-Boundary-Audited', 'true')
          }
        })
        `
      )

      await fs.writeFile(
        path.join(apiDir, 'route.js'),
        `
        const { controller, route } = require('${routerPath}')
        exports.default = controller({
          action: route.get('/action', {
            async handle() {
              return { success: true }
            }
          })
        })
        `
      )

      app = new App()
      await app.autoMountRoutes(tmpDir)

      // Test unauthorized access
      const failRes = await createTestApp(app).get('/api/action')
      expect(failRes.status).toBe(401)
      expect(failRes.body.error).toBe('Unauthorized boundary access')

      // Test authorized access
      const okRes = await createTestApp(app)
        .get('/api/action')
        .set('x-admin-key', 'secret')
      expect(okRes.status).toBe(200)
      expect(okRes.body.success).toBe(true)
      expect(okRes.headers['x-boundary-audited']).toBe('true')
    })

    it('returns 403 Forbidden when beforeHandle returns false without sending headers', async () => {
      const httpDir = path.join(tmpDir, 'src', 'http')
      const secureDir = path.join(httpDir, 'secure')
      await fs.mkdir(secureDir, { recursive: true })

      await fs.writeFile(
        path.join(secureDir, 'boundary.js'),
        `
        const { defineBoundary } = require('${routerPath}')
        exports.config = defineBoundary({
          beforeHandle(req) {
            if (req.headers['x-allow'] !== 'yes') {
              return false
            }
          }
        })
        `
      )

      await fs.writeFile(
        path.join(secureDir, 'route.js'),
        `
        const { controller, route } = require('${routerPath}')
        exports.default = controller({
          data: route.get('/data', {
            async handle() {
              return { secret: 42 }
            }
          })
        })
        `
      )

      app = new App()
      await app.autoMountRoutes(tmpDir)

      const forbiddenRes = await createTestApp(app).get('/secure/data')
      expect(forbiddenRes.status).toBe(403)
      expect(forbiddenRes.body.error.code).toBe('FORBIDDEN')

      const allowedRes = await createTestApp(app)
        .get('/secure/data')
        .set('x-allow', 'yes')
      expect(allowedRes.status).toBe(200)
      expect(allowedRes.body.secret).toBe(42)
    })

    it('executes afterHandle to transform response payload and perform auditing', async () => {
      const httpDir = path.join(tmpDir, 'src', 'http')
      const productsDir = path.join(httpDir, 'products')
      await fs.mkdir(productsDir, { recursive: true })

      await fs.writeFile(
        path.join(productsDir, 'boundary.js'),
        `
        const { defineBoundary } = require('${routerPath}')
        exports.config = defineBoundary({
          afterHandle(req, res, data) {
            res.setHeader('X-Audited-After', 'true')
            return {
              ...data,
              cachedAt: 123456,
              meta: { version: '1.0' }
            }
          }
        })
        `
      )

      await fs.writeFile(
        path.join(productsDir, 'route.js'),
        `
        const { controller, route } = require('${routerPath}')
        exports.default = controller({
          list: route.get('/list', {
            async handle() {
              return { items: ['apple', 'banana'] }
            }
          })
        })
        `
      )

      app = new App()
      await app.autoMountRoutes(tmpDir)

      const res = await createTestApp(app).get('/products/list')
      expect(res.status).toBe(200)
      expect(res.headers['x-audited-after']).toBe('true')
      expect(res.body.items).toEqual(['apple', 'banana'])
      expect(res.body.cachedAt).toBe(123456)
      expect(res.body.meta.version).toBe('1.0')
    })

    it('respects exclude rules to bypass boundary hooks', async () => {
      const httpDir = path.join(tmpDir, 'src', 'http')
      const v1Dir = path.join(httpDir, 'v1')
      await fs.mkdir(v1Dir, { recursive: true })

      await fs.writeFile(
        path.join(v1Dir, 'boundary.js'),
        `
        const { defineBoundary } = require('${routerPath}')
        exports.config = defineBoundary({
          exclude: ['/v1/health'],
          beforeHandle(req, res) {
            return false // block everything by default
          },
          afterHandle(req, res, data) {
            return { ...data, boundaryModified: true }
          }
        })
        `
      )

      await fs.writeFile(
        path.join(v1Dir, 'route.js'),
        `
        const { controller, route } = require('${routerPath}')
        exports.default = controller({
          health: route.get('/health', {
            async handle() {
              return { status: 'ok' }
            }
          }),
          users: route.get('/users', {
            async handle() {
              return { users: [] }
            }
          })
        })
        `
      )

      app = new App()
      await app.autoMountRoutes(tmpDir)

      // /v1/health is excluded, so beforeHandle (returning false) does not run
      const healthRes = await createTestApp(app).get('/v1/health')
      expect(healthRes.status).toBe(200)
      expect(healthRes.body.status).toBe('ok')
      expect(healthRes.body.boundaryModified).toBeUndefined()

      // /v1/users is not excluded, so it gets blocked with 403
      const usersRes = await createTestApp(app).get('/v1/users')
      expect(usersRes.status).toBe(403)
    })

    it('supports class-based @Boundary beforeHandle and afterHandle methods', async () => {
      const httpDir = path.join(tmpDir, 'src', 'http')
      const oopDir = path.join(httpDir, 'oop')
      await fs.mkdir(oopDir, { recursive: true })

      await fs.writeFile(
        path.join(oopDir, 'boundary.js'),
        `
        const { Boundary } = require('${decoratorsPath}')

        class OopBoundary {
          beforeHandle(req, res) {
            res.setHeader('X-OOP-Before', 'invoked')
          }
          afterHandle(req, res, data) {
            return { ...data, oopTransformed: true }
          }
        }
        Boundary()(OopBoundary)
        exports.default = OopBoundary
        `
      )

      await fs.writeFile(
        path.join(oopDir, 'route.js'),
        `
        const { controller, route } = require('${routerPath}')
        exports.default = controller({
          test: route.get('/test', {
            async handle() {
              return { value: 99 }
            }
          })
        })
        `
      )

      app = new App()
      await app.autoMountRoutes(tmpDir)

      const res = await createTestApp(app).get('/oop/test')
      expect(res.status).toBe(200)
      expect(res.headers['x-oop-before']).toBe('invoked')
      expect(res.body.value).toBe(99)
      expect(res.body.oopTransformed).toBe(true)
    })
  })

  describe('Process Lifecycle: IPC Graceful Shutdown', () => {
    it('executes onClose hook and exits cleanly when receiving IPC shutdown message', async () => {
      const serverFile = path.join(tmpDir, 'server.js')
      const logFile = path.join(tmpDir, 'cron.log')
      const exisPath = path.join(__dirname, '../src/index').replace(/\\/g, '/')
      const startServerPath = path
        .join(__dirname, '../src/lib/start-server.ts')
        .replace(/\\/g, '/')

      await fs.writeFile(
        serverFile,
        `
        const { exis } = require('${exisPath}')
        const fs = require('fs')

        const timer = setInterval(() => {}, 1000)

        exports.default = exis({
          port: 0,
          onClose() {
            clearInterval(timer)
            fs.writeFileSync('${logFile.replace(/\\/g, '\\\\')}', 'CRON_STOPPED_CLEANLY')
          }
        })
        `
      )

      const cp = await import('node:child_process')
      const { pathToFileURL } = await import('node:url')
      const tsxUrl = pathToFileURL(
        require.resolve('tsx', { paths: [tmpDir, __dirname] })
      ).href

      let errOutput = ''
      let stdOutput = ''
      const child = cp.spawn(
        process.execPath,
        ['--import', tsxUrl, startServerPath],
        {
          cwd: tmpDir,
          env: {
            ...process.env,
            EXIS_ENTRY_FILE: serverFile,
            __EXIS_DEV_SERVER: '1',
            PORT: '0',
          },
          stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
        }
      )

      child.stdout?.on('data', (d) => {
        stdOutput += d.toString()
      })
      child.stderr?.on('data', (d) => {
        errOutput += d.toString()
      })

      // Wait a moment for server to boot
      await new Promise((r) => setTimeout(r, 1200))

      // Send IPC shutdown message
      if (!child.connected) {
        throw new Error(
          `Child failed to start or keep connection. stdout: ${stdOutput}, stderr: ${errOutput}`
        )
      }
      child.send({ type: 'exis:shutdown' })

      const exitCode = await new Promise<number | null>((resolve) => {
        child.on('close', (code) => resolve(code))
        setTimeout(() => {
          child.kill('SIGKILL')
          resolve(-1)
        }, 5000)
      })
      expect(exitCode).toBe(0)
      const logContent = await fs.readFile(logFile, 'utf-8')
      expect(logContent).toBe('CRON_STOPPED_CLEANLY')
    })
  })
})
