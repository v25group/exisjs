import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { App } from '../src/server/app'
import { Router } from '../src/router/router'
import { exis } from '../src/index'
import { createTestApp } from '../src/testing/client'
import { createTestContext, describe, expect, it } from '../src/testing'

function tempHttpDir(boundarySource: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exis-boundary-'))
  fs.mkdirSync(path.join(dir, 'users'))
  // .cjs so the fixture loads the same way under any module setting
  fs.writeFileSync(path.join(dir, 'boundary.js'), boundarySource)
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"commonjs"}')
  return dir
}

function usersRouter(): Router {
  const router = new Router()
  router.get('/', (_req, res) => {
    res.json({ ok: true })
  })
  return router
}

describe('Boundaries for routes loaded from the production manifest', () => {
  it('applies boundary headers and guards to a preloaded route module', async () => {
    const dir = tempHttpDir(`
      exports.config = {
        headers: { 'X-From-Boundary': 'yes' },
        middleware: [
          (req, res, next) => {
            if (req.header('x-allow') !== '1') {
              res.status(403).json({ blocked: true })
              return
            }
            next()
          },
        ],
      }
    `)
    const app = new App({ logger: false })
    const scanner = app.getScanner()
    scanner.apiDir = dir

    // The manifest passes the already-imported module as the third argument
    await scanner.mountRouteFile(
      path.join(dir, 'users', 'route.js'),
      '/users',
      { router: usersRouter() }
    )

    const client = createTestApp(app)
    const blocked = await client.get('/users')
    expect(blocked.status).toBe(403)

    const allowed = await client.get('/users').set('x-allow', '1')
    expect(allowed.status).toBe(200)
    expect(allowed.headers['x-from-boundary']).toBe('yes')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('refuses to mount a route whose boundary fails to load', async () => {
    const dir = tempHttpDir(`throw new Error('boundary exploded')`)
    const app = new App({ logger: false })
    const scanner = app.getScanner()
    scanner.apiDir = dir

    let message = ''
    try {
      await scanner.mountRouteFile(
        path.join(dir, 'users', 'route.js'),
        '/users',
        { router: usersRouter() }
      )
    } catch (err: any) {
      message = err.message
    }
    expect(message.includes('Failed to load boundary')).toBe(true)

    // Fail closed: the unprotected route is not reachable
    const res = await createTestApp(app).get('/users')
    expect(res.status).toBe(404)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('createTestContext with an exis() definition', () => {
  let started = 0
  const api = createTestContext(
    exis({
      logger: false,
      async onStart(app) {
        started++
        app.provide('Greeting', { useValue: 'hello' })
        app.get('/greet', (_req, res) => {
          res.json({ greeting: app.resolve<string>('Greeting') })
        })
      },
    })
  )

  it('runs onStart, so providers and routes registered there exist', async () => {
    const res = await api.get('/greet').execute()
    expect(started).toBe(1)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ greeting: 'hello' })
  })
})

describe('Validation diagnostics', () => {
  it('redacts credential fields in error details', async () => {
    const { tex } = await import('../src/validator/index')
    const app = new App({ logger: false })
    app.post(
      '/login',
      {
        body: tex.object({
          email: tex.email(),
          password: tex.string({ min: 12 }),
        }),
      },
      (_req, res) => {
        res.json({ ok: true })
      }
    )
    const res = await createTestApp(app)
      .post('/login')
      .send({ email: 'a@b.co', password: 'hunter2' })
    expect(res.status).toBe(400)
    expect(res.text.includes('hunter2')).toBe(false)
    const byField = Object.fromEntries(
      res.body.details.map((d: any) => [d.field, d.received])
    )
    expect(byField.password).toBe('[Redacted]')
  })
})
