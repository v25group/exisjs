// A client sending a body a few bytes at a time held a connection for Node's
// default 5 minutes, and forever on uWS and Bun, which only close idle
// connections. `requestTimeout` (default 60 s) now bounds it on every engine.
import net from 'node:net'
import { App } from '../src/server/app'
import { controller, route } from '../src/router/index'
import { BunIncomingMessage } from '../src/server/adapters/bun-adapter'
import { describe, expect, it } from '../src/testing'
import { createTempDir } from './helpers'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function startApp(server: 'node' | 'uws', requestTimeout: number) {
  const app = new App({
    env: 'production',
    logger: false,
    server,
    requestTimeout,
  }) as any
  const router = app.routeScanner.compileFunctionalController(
    controller({
      echo: route.post('/echo', {
        public: true,
        handle: async ({ req }: any) => ({ got: (await req.text()).length }),
      }),
      slow: route.post('/slow', {
        public: true,
        handle: async ({ req }: any) => {
          await req.text()
          await sleep(1500)
          return { ok: true }
        },
      }),
    })
  )
  app.routeScanner.mountRouteWithSource('/', router, 'src/http/route.ts')
  await app.create(createTempDir('exis-timeout-'))
  const port = 4900 + Math.floor(Math.random() * 90)
  await new Promise<void>((resolve) =>
    app.listen({ port, host: '127.0.0.1' }, resolve)
  )
  return { app, port }
}

/**
 * Sends headers for a 100-byte body, then one byte every 200 ms. Resolves
 * with what the server sent and how long the connection stayed open.
 */
function trickle(port: number, maxMs: number) {
  return new Promise<{ text: string; ms: number; closed: boolean }>(
    (resolve) => {
      const started = Date.now()
      let text = ''
      const socket = net.connect(port, '127.0.0.1')
      let timer: NodeJS.Timeout
      const done = (closed: boolean) => {
        clearInterval(timer)
        socket.destroy()
        resolve({ text, ms: Date.now() - started, closed })
      }
      socket.on('connect', () => {
        socket.write(
          'POST /echo HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: text/plain\r\nContent-Length: 100\r\n\r\n'
        )
        timer = setInterval(() => {
          if (!socket.destroyed) socket.write('x')
        }, 200)
      })
      socket.on('data', (d) => (text += d.toString()))
      socket.on('close', () => done(true))
      socket.on('error', () => done(true))
      setTimeout(() => done(false), maxMs)
    }
  )
}

let hasUws = true
try {
  require('uWebSockets.js')
} catch {
  hasUws = false
}

for (const server of ['node', 'uws'] as const) {
  const options = {
    skip:
      server === 'uws' && !hasUws ? 'uWebSockets.js is not installed' : false,
  }

  describe(`requestTimeout on ${server}`, () => {
    it(
      'closes a connection whose body arrives too slowly',
      options,
      async () => {
        const { app, port } = await startApp(server, 1000)
        try {
          // 100 bytes at 5 per second would take 20 s
          const result = await trickle(port, 8000)
          expect(result.closed).toBe(true)
          expect(result.ms).toBeLessThan(5000)
          // Node answers 408 before closing, but a client still sending can
          // get a reset first and never read it, so only the close is checked
        } finally {
          await app.close()
        }
      }
    )

    it(
      'does not cut a slow handler once the request has arrived',
      options,
      async () => {
        const { app, port } = await startApp(server, 1000)
        try {
          const res = await fetch(`http://127.0.0.1:${port}/slow`, {
            method: 'POST',
            body: 'hello',
          })
          expect(res.status).toBe(200)
        } finally {
          await app.close()
        }
      }
    )

    it('reads a body that arrives in time', options, async () => {
      const { app, port } = await startApp(server, 1000)
      try {
        const res = await fetch(`http://127.0.0.1:${port}/echo`, {
          method: 'POST',
          body: 'x'.repeat(5000),
        })
        expect(res.status).toBe(200)
        expect(((await res.json()) as any).got).toBe(5000)
      } finally {
        await app.close()
      }
    })
  })
}

describe('requestTimeout on Bun', () => {
  it('rejects a body that never finishes with 408', async () => {
    const neverEnds = {
      method: 'POST',
      url: 'http://localhost/echo',
      headers: new Map([['content-length', '100']]),
      body: {},
      arrayBuffer: () => new Promise<ArrayBuffer>(() => {}),
    }
    const req = new BunIncomingMessage(neverEnds, '127.0.0.1', 100)
    const err: any = await req.readBody()!.catch((e) => e)
    expect(err.statusCode).toBe(408)
    expect(err.code).toBe('REQUEST_TIMEOUT')
  })

  it('reads a body that arrives in time', async () => {
    const ok = {
      method: 'POST',
      url: 'http://localhost/echo',
      headers: new Map([['content-length', '2']]),
      body: {},
      arrayBuffer: async () => new TextEncoder().encode('hi').buffer,
    }
    const req = new BunIncomingMessage(ok, '127.0.0.1', 100)
    expect((await req.readBody())!.toString()).toBe('hi')
  })
})

describe('requestTimeout setting', () => {
  it('defaults to 60 seconds', () => {
    expect((new App() as any).options.requestTimeout).toBe(60_000)
  })
})

// B27: inject() joined repeated Set-Cookie headers into one string, which
// can't be split again because Expires dates contain commas
describe('inject() and Set-Cookie (B27)', () => {
  it('returns each cookie separately', async () => {
    const app = new App({ env: 'production', logger: false }) as any
    const router = app.routeScanner.compileFunctionalController(
      controller({
        cookies: route.get('/cookies', {
          public: true,
          handle: ({ res }: any) => {
            res.cookie('a', '1', { expires: new Date('2030-01-01T00:00:00Z') })
            res.cookie('b', '2')
            return { ok: true }
          },
        }),
        one: route.get('/one', {
          public: true,
          handle: ({ res }: any) => {
            res.cookie('only', 'x')
            return { ok: true }
          },
        }),
      })
    )
    app.routeScanner.mountRouteWithSource('/', router, 'src/http/route.ts')
    await app.create(createTempDir('exis-cookies-'))

    const res = await app.inject({ url: '/cookies' })
    const cookies = res.headers['set-cookie']
    expect(Array.isArray(cookies)).toBe(true)
    expect(cookies).toHaveLength(2)
    expect(cookies[0]).toContain('a=1')
    expect(cookies[0]).toContain('Tue, 01 Jan 2030')
    expect(cookies[1]).toContain('b=2')

    const single = await app.inject({ url: '/one' })
    expect(single.headers['set-cookie']).toHaveLength(1)
    await app.close?.()
  })
})
