import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { App } from '../src/server/app'
import { controller, route } from '../src/router/index'
import { ipFilter, serveStatic } from '../src/middleware/middleware'
import { fileUpload } from '../src/middleware/upload'
import { resolveHost, resolveProtocol } from '../src/server/helpers/ip'
import { mediaTypeOf } from '../src/server/helpers/media-type'
import { UwsServerResponse } from '../src/server/adapters/uws-adapter'
import {
  BunIncomingMessage,
  BunServerResponse,
} from '../src/server/adapters/bun-adapter'
import { formatSSEEvent } from '../src/server/sse'
import { documentationCsp, renderDocumentationHtml } from '../src/swagger/ui'
import { tex } from '../src/validator/tex'
import { createTestApp, describe, expect, it } from '../src/testing'
import { createTempDir, cleanupTempDir } from './helpers'

function appWith(routes: Record<string, any>, options: any = {}) {
  const app = new App({ env: 'production', logger: false, ...options })
  const router = app.routeScanner.compileFunctionalController(
    controller(routes)
  )
  app.routeScanner.mountRouteWithSource('/', router, 'src/http/route.ts')
  return app
}

const multipartBody = (fields: Record<string, string>) => {
  const boundary = 'TestBoundary'
  const parts = Object.entries(fields).map(
    ([name, value]) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  )
  return {
    body: `${parts.join('')}--${boundary}--\r\n`,
    type: `multipart/form-data; boundary=${boundary}`,
  }
}

describe('reading a request body by its media type', () => {
  const app = () =>
    appWith({
      save: route.post('/save', {
        public: true,
        body: tex.object({ title: tex.string() }),
        handle: ({ body }: any) => ({ title: body.title }),
      }),
    })
  const post = (type: string | undefined) => {
    const req = createTestApp(app()).post('/save')
    if (type) req.set('content-type', type)
    return req.send(JSON.stringify({ title: 'x' }))
  }

  it('reads the media type alone', () => {
    expect(mediaTypeOf('Application/JSON; charset=utf-8')).toBe(
      'application/json'
    )
    expect(mediaTypeOf('text/plain; x=multipart/form-data')).toBe('text/plain')
    expect(mediaTypeOf(undefined)).toBe('')
  })

  it('refuses JSON sent as a type a browser posts cross-site', async () => {
    for (const type of ['text/plain', 'text/plain; charset=utf-8']) {
      const res = await post(type)
      expect(res.status).toBe(415)
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
    }
  })

  it('refuses headers that only mention a known type', async () => {
    for (const type of [
      'text/plain; x=multipart/form-data; boundary=x',
      'text/plain; x=application/x-www-form-urlencoded',
      'application/jsonfoo',
      'application/json\tfoo',
      'application/xml',
    ]) {
      expect((await post(type)).status).toBe(415)
    }
  })

  it('accepts JSON in its real forms', async () => {
    for (const type of [
      'application/json',
      'APPLICATION/JSON',
      'application/json; charset=utf-8',
      'application/vnd.api+json',
    ]) {
      const res = await post(type)
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('x')
    }
  })

  it('still reads forms', async () => {
    const res = await createTestApp(app())
      .post('/save')
      .set('content-type', 'application/x-www-form-urlencoded')
      .send('title=x')

    expect(res.status).toBe(200)
  })
})

describe('multipart bodies', () => {
  const app = () =>
    appWith(
      {
        form: route.post('/form', {
          public: true,
          body: tex.object({}, { strict: false } as any),
          handle: () => ({ ok: true }),
        }),
        upload: route.post('/upload', {
          public: true,
          middleware: [fileUpload({ destination: 'memory' })],
          handle: ({ req }: any) => ({ keys: Object.keys(req.body ?? {}) }),
        }),
      },
      { bodyLimit: 1024 * 1024 }
    )
  const send = (path: string, body: string, type: string) =>
    createTestApp(app()).post(path).set('content-type', type).send(body)

  for (const route of ['/form', '/upload']) {
    it(`${route} counts fields towards bodyLimit`, async () => {
      const fields: Record<string, string> = {}
      for (let i = 0; i < 5; i++) fields[`f${i}`] = 'a'.repeat(500 * 1024)
      const { body, type } = multipartBody(fields)

      expect((await send(route, body, type)).status).toBe(413)
    })

    it(`${route} refuses one field over the field size limit`, async () => {
      const { body, type } = multipartBody({ big: 'a'.repeat(1100 * 1024) })

      expect((await send(route, body, type)).status).toBe(413)
    })

    it(`${route} still accepts fields under the limit`, async () => {
      const { body, type } = multipartBody({ a: 'x', b: 'y' })

      expect((await send(route, body, type)).status).toBeLessThan(400)
    })
  }

  it('answers 400, not 500, for a malformed body', async () => {
    const res = await send(
      '/form',
      '{"title":123}',
      'multipart/form-data; boundary=x'
    )

    expect(res.status).toBe(400)
  })

  it('drops prototype keys from uploaded form fields', async () => {
    const { body, type } = multipartBody({ constructor: 'x', ok: 'y' })

    const res = await send('/upload', body, type)

    expect(res.body.keys).toEqual(['ok'])
  })
})

describe('serveStatic dotfiles', () => {
  const withFolder = async (run: (app: App) => Promise<void>, options = {}) => {
    const root = createTempDir('exis-static-')
    try {
      fs.writeFileSync(path.join(root, 'index.html'), 'public')
      fs.writeFileSync(path.join(root, '.env'), 'SECRET')
      fs.mkdirSync(path.join(root, '.git'))
      fs.writeFileSync(path.join(root, '.git', 'config'), 'SECRET')
      fs.mkdirSync(path.join(root, '.well-known'))
      fs.writeFileSync(path.join(root, '.well-known', 'security.txt'), 'ok')
      fs.mkdirSync(path.join(root, 'sub'))
      fs.writeFileSync(path.join(root, 'sub', '.hidden'), 'SECRET')
      const app = new App({ env: 'production', logger: false } as any)
      app.use(serveStatic(root, options))
      await run(app)
    } finally {
      cleanupTempDir(root)
    }
  }

  it('hides files and folders starting with a dot', () =>
    withFolder(async (app) => {
      const api = createTestApp(app)
      for (const url of [
        '/.env',
        '/%2eenv',
        '/.git/config',
        '/sub/.hidden',
        '/x/../.env',
      ]) {
        const res = await api.get(url)
        expect(res.status).toBe(404)
        expect(res.text).not.toContain('SECRET')
      }
    }))

  it('serves normal files and /.well-known', () =>
    withFolder(async (app) => {
      const api = createTestApp(app)
      expect((await api.get('/index.html')).status).toBe(200)
      expect((await api.get('/.well-known/security.txt')).status).toBe(200)
    }))

  it('serves them all with dotfiles: allow', () =>
    withFolder(
      async (app) => {
        expect((await createTestApp(app).get('/.env')).status).toBe(200)
      },
      { dotfiles: 'allow' }
    ))
})

describe('what errors show in production', () => {
  const throwing = (error: Error) =>
    createTestApp(
      appWith({
        boom: route.get('/boom', {
          public: true,
          handle: () => {
            throw error
          },
        }),
      })
    ).get('/boom')

  it('hides a failed connection, which names an internal host', async () => {
    const res = await throwing(
      new (globalThis as any).AggregateError(
        [new Error('connect ECONNREFUSED 10.0.0.5:27017')],
        'connect ECONNREFUSED 10.0.0.5:27017'
      )
    )

    expect(res.status).toBe(500)
    expect(res.text).not.toContain('10.0.0.5')
  })

  it('hides a driver error with an errors array', async () => {
    class MongoBulkWriteError extends Error {
      errors = [{ message: 'E11000 duplicate key: internal.users' }]
    }

    const res = await throwing(new MongoBulkWriteError('E11000 internal.users'))

    expect(res.status).toBe(500)
    expect(res.text).not.toContain('internal.users')
  })

  it('still answers 400 for real validation errors', async () => {
    const zod = Object.assign(new Error('bad'), {
      name: 'ZodError',
      issues: [{ path: ['a'], message: 'Required' }],
    })
    const issues = Object.assign(new Error('bad'), {
      issues: [{ path: ['a'], message: 'Required' }],
    })
    const fields = Object.assign(new Error('bad'), {
      errors: { email: 'Required' },
    })

    for (const err of [zod, issues, fields]) {
      expect((await throwing(err)).status).toBe(400)
    }
  })
})

describe('forwarded host and protocol', () => {
  const raw = (
    headers: Record<string, string>,
    remoteAddress = '203.0.113.9'
  ) => ({ headers, socket: { remoteAddress } }) as any

  it('ignores a protocol that is not http or https', () => {
    expect(
      resolveProtocol(raw({ 'x-forwarded-proto': 'javascript' }), true)
    ).toBe('http')
    expect(
      resolveProtocol(raw({ 'cf-visitor': '{"scheme":"javascript"}' }), true)
    ).toBe('http')
  })

  it('still reads a real forwarded protocol', () => {
    expect(resolveProtocol(raw({ 'x-forwarded-proto': 'https' }), true)).toBe(
      'https'
    )
  })

  it('ignores a forwarded host that is not a host', () => {
    for (const value of ['evil.example/path', 'a b', 'evil"><script>', 'x@y']) {
      expect(
        resolveHost(raw({ host: 'app', 'x-forwarded-host': value }), true)
      ).toBe('app')
    }
  })

  it('reads real forwarded hosts', () => {
    for (const value of [
      'app.example.com',
      'app.example.com:8443',
      '[::1]:80',
    ]) {
      expect(resolveHost(raw({ 'x-forwarded-host': value }), true)).toBe(value)
    }
  })

  it("'cloudflare' ignores these headers from a direct client", () => {
    const direct = raw({
      host: 'app',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https',
      'cf-visitor': '{"scheme":"https"}',
    })

    expect(resolveHost(direct, 'cloudflare')).toBe('app')
    expect(resolveProtocol(direct, 'cloudflare')).toBe('http')
  })

  it("'cloudflare' reads them from Cloudflare", () => {
    const fromCf = raw(
      { host: 'origin', 'x-forwarded-host': 'app.example.com' },
      '104.16.0.1'
    )

    expect(resolveHost(fromCf, 'cloudflare')).toBe('app.example.com')
  })
})

describe('ipFilter', () => {
  const call = (options: any, ip: string) => {
    const req: any = { ip }
    let error: any = 'not called'
    ipFilter(options)(req, {} as any, (err?: any) => {
      error = err
    })
    return error === undefined
  }

  it('applies IPv6 CIDR rules, which used to be ignored', () => {
    expect(call({ deny: ['2001:db8::/32'] }, '2001:db8::1')).toBe(false)
    expect(call({ deny: ['2001:db8::/32'] }, '2001:db9::1')).toBe(true)
    expect(call({ allow: ['2001:db8::/32'] }, '2001:db8::1')).toBe(true)
    expect(call({ allow: ['2001:db8::/32'] }, '2001:db9::1')).toBe(false)
  })

  it('treats a mapped IPv4 address as IPv4', () => {
    expect(call({ deny: ['10.0.0.0/8'] }, '::ffff:10.1.2.3')).toBe(false)
  })

  it('keeps IPv4 rules working', () => {
    expect(call({ deny: ['10.0.0.0/8'] }, '10.1.2.3')).toBe(false)
    expect(call({ deny: ['10.0.0.0/8'] }, '11.1.2.3')).toBe(true)
    expect(call({ allow: ['192.168.1.1'] }, '192.168.1.1')).toBe(true)
    expect(call({ allow: ['192.168.1.1'] }, '192.168.1.2')).toBe(false)
  })

  it('never allows an unknown address', () => {
    expect(call({ allow: ['0.0.0.0/0'] }, '')).toBe(false)
  })

  it('refuses a rule it cannot read, instead of ignoring it', () => {
    for (const rule of [
      '10.0.0.0/33',
      'not-an-ip',
      '2001:db8::/129',
      '10.0/8',
    ]) {
      expect(() => ipFilter({ deny: [rule] })).toThrow(/ipFilter/)
    }
  })
})

describe('tex.string and null bytes', () => {
  const schema = tex.object({ q: tex.string() })

  it('refuses a null byte', () => {
    for (const q of ['a\0b', '\0', 'a\0']) {
      expect(schema.safeParse({ q }).success).toBe(false)
    }
  })

  it('still accepts other text', () => {
    expect(schema.parse({ q: 'a\nb\tc é 日本語' }).q).toBe('a\nb\tc é 日本語')
  })
})

describe('uWS responses', () => {
  const fake = () => {
    const calls: [string, ...unknown[]][] = []
    const uws: any = {
      cork: (fn: () => void) => fn(),
      writeStatus: (s: string) => calls.push(['status', s]),
      writeHeader: (k: string, v: string) => calls.push(['header', k, v]),
      write: (d: unknown) => (calls.push(['write', d]), true),
      end: (d?: unknown) => calls.push(['end', d]),
    }
    return { calls, res: new UwsServerResponse(uws) }
  }

  it('refuses a CRLF in a header value', () => {
    const { res } = fake()

    expect(() =>
      res.setHeader('location', 'x\r\nSet-Cookie: hacked=1')
    ).toThrow()
    expect(() => res.setHeader('x-bad\r\nname', 'x')).toThrow()
    expect(() =>
      res.setHeader('set-cookie', ['ok=1', 'x\r\nhacked=1'])
    ).toThrow()
  })

  it('writes each cookie as its own header', () => {
    const { calls, res } = fake()

    res.setHeader('set-cookie', ['a=1', 'b=2'])
    res.end('x')

    expect(calls.filter((c) => c[0] === 'header')).toEqual([
      ['header', 'set-cookie', 'a=1'],
      ['header', 'set-cookie', 'b=2'],
    ])
  })

  it('ends a response after streaming, which used to hang', () => {
    const { calls, res } = fake()

    res.write('chunk')
    expect(res.writableEnded).toBe(false)
    res.end()

    expect(calls.filter((c) => c[0] === 'status')).toHaveLength(1)
    expect(calls[calls.length - 1][0]).toBe('end')
    expect(res.writableEnded).toBe(true)
  })

  it('ends only once', () => {
    const { calls, res } = fake()

    res.end('a')
    res.end('b')

    expect(calls.filter((c) => c[0] === 'end')).toHaveLength(1)
  })
})

describe('a real uWS server', () => {
  let hasUws = true
  try {
    require('uWebSockets.js')
  } catch {
    hasUws = false
  }

  const options = { skip: hasUws ? false : 'uWebSockets.js is not installed' }

  const withServer = async (
    run: (url: string) => Promise<void>,
    bodyLimit = 1024 * 1024
  ) => {
    const app = appWith(
      {
        echo: route.post('/echo', {
          public: true,
          body: tex.object({ text: tex.string() }),
          handle: ({ body }: any) => ({ size: body.text.length }),
        }),
        ignore: route.post('/ignore', {
          public: true,
          handle: () => ({ ok: true }),
        }),
        cookies: route.get('/cookies', {
          public: true,
          handle: ({ res }: any) => {
            res.cookie('a', '1')
            res.cookie('b', '2')
            return { ok: true }
          },
        }),
        form: route.post('/form', {
          public: true,
          body: tex.object({ a: tex.string() }),
          handle: ({ body }: any) => ({ a: body.a }),
        }),
      },
      { server: 'uws', port: 0, host: '127.0.0.1', bodyLimit }
    ) as any
    await app.create(createTempDir('exis-uws-'))
    const port = 4790 + Math.floor(Math.random() * 100)
    await new Promise<void>((resolve) =>
      app.listen({ port, host: '127.0.0.1' }, resolve)
    )
    try {
      await run(`http://127.0.0.1:${port}`)
    } finally {
      await app.close()
    }
  }

  it(
    'reads a body that spans several chunks, which used to crash the process',
    options,
    () =>
      withServer(async (url) => {
        const text = 'x'.repeat(600 * 1024)
        const res = await fetch(`${url}/echo`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        })

        expect(res.status).toBe(200)
        expect(((await res.json()) as any).size).toBe(text.length)
      })
  )

  it('refuses a body over bodyLimit, declared or not', options, () =>
    withServer(async (url) => {
      const big = JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024) })
      const declared = await fetch(`${url}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: big,
      })
      expect(declared.status).toBe(413)

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(big))
          controller.close()
        },
      })
      const chunked = await fetch(`${url}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: stream,
        duplex: 'half',
      } as any)
      expect(chunked.status).toBe(413)
    })
  )

  it('reads a chunked body, which used to arrive empty', options, () =>
    withServer(async (url) => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"text":"chunked"}'))
          controller.close()
        },
      })
      const res = await fetch(`${url}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: stream,
        duplex: 'half',
      } as any)

      expect(res.status).toBe(200)
      expect(((await res.json()) as any).size).toBe(7)
    })
  )

  it('keeps answering after a route ignores a large body', options, () =>
    withServer(async (url) => {
      const res = await fetch(`${url}/ignore`, {
        method: 'POST',
        body: 'x'.repeat(2 * 1024 * 1024),
      })
      expect(res.status).toBeLessThan(500)

      const again = await fetch(`${url}/ignore`, { method: 'POST', body: 'x' })
      expect(again.status).toBe(200)
    })
  )

  it('sends each cookie separately', options, () =>
    withServer(async (url) => {
      const res = await fetch(`${url}/cookies`)

      expect(res.headers.getSetCookie().length).toBe(2)
    })
  )

  it('parses a multipart form, which used to hang', options, () =>
    withServer(async (url) => {
      const { body, type } = multipartBody({ a: 'field' })
      const res = await fetch(`${url}/form`, {
        method: 'POST',
        headers: { 'content-type': type },
        body,
        signal: AbortSignal.timeout(5000),
      })

      expect(res.status).toBe(200)
      expect(((await res.json()) as any).a).toBe('field')
    })
  )
})

describe('server-sent events', () => {
  const format = (message: unknown) => formatSSEEvent(message)
  const lines = (text: string) => text.split(/\r\n|\r|\n/)

  for (const [name, attack] of [
    ['LF', 'hi\n\nevent: admin\ndata: injected'],
    ['CR', 'hi\r\revent: admin\rdata: injected'],
    ['CRLF', 'hi\r\n\r\nevent: admin\r\ndata: injected'],
  ]) {
    it(`keeps ${name} in data from starting an event`, () => {
      const out = lines(format({ data: attack }))

      expect(out.includes('event: admin')).toBe(false)
      expect(out.includes('data: event: admin')).toBe(true)
    })

    for (const field of ['event', 'id', 'retry']) {
      it(`keeps ${name} in ${field} on one line`, () => {
        const out = lines(format({ [field]: attack, data: 'x' }))

        expect(out.includes('event: admin')).toBe(false)
        expect(out.includes('data: injected')).toBe(false)
      })
    }
  }

  it('still sends normal fields', () => {
    expect(format({ event: 'delta', id: 7, data: 'hi' })).toBe(
      'id: 7\nevent: delta\ndata: hi\n\n'
    )
  })
})

describe('the host on HTTP/2', () => {
  const raw = (headers: Record<string, string>) =>
    ({ headers, socket: { remoteAddress: '203.0.113.9' } }) as any

  it('reads :authority, which is where HTTP/2 names the host', () => {
    expect(resolveHost(raw({ ':authority': 'app.example.com' }), false)).toBe(
      'app.example.com'
    )
  })

  it('prefers :authority over a Host header the client added', () => {
    expect(
      resolveHost(
        raw({ ':authority': 'app.example.com', host: 'evil.example' }),
        false
      )
    ).toBe('app.example.com')
  })
})

describe('docs page', () => {
  for (const ui of ['swagger-ui', 'scalar'] as const) {
    it(`${ui} loads no outside script or style without integrity`, () => {
      const html = renderDocumentationHtml({ ui } as any)
      const tags =
        html.match(/<(script|link)[^>]*(src|href)="https:[^>]*>/g) ?? []
      const assets = tags.filter((t) => !t.includes('rel="icon"'))

      expect(assets.length).toBeGreaterThan(0)
      for (const tag of assets) {
        expect(tag).toMatch(/integrity="sha384-/)
        expect(tag).toMatch(/crossorigin="anonymous"/)
      }
    })
  }
})

describe('docs page policy', () => {
  it('allows Swagger UI its inline script by hash, not unsafe-inline', () => {
    const config = { ui: 'swagger-ui', specPath: '/api/spec' } as any
    const inline = /<script>([\s\S]*?)<\/script>/.exec(
      renderDocumentationHtml(config)
    )![1]
    const hash = crypto.createHash('sha256').update(inline).digest('base64')
    const script = documentationCsp(config)
      .split('; ')
      .find((d) => d.startsWith('script-src'))!

    expect(script).toContain(`'sha256-${hash}'`)
    expect(script).not.toContain('unsafe-inline')
  })

  it('gives Scalar, which has no inline script, no hash', () => {
    const csp = documentationCsp({ ui: 'scalar' } as any)

    expect(csp).not.toContain('sha256-')
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
  })

  it('limits form targets, which default-src does not cover', () => {
    expect(documentationCsp({} as any)).toContain("form-action 'self'")
  })
})

describe('cross-origin headers', () => {
  const headers = async (helmet: any) => {
    const app = new App({ logger: false, helmet } as any)
    app.get('/ping', () => ({ ok: true }))
    return (await createTestApp(app).get('/ping')).headers
  }

  it('are sent by default', async () => {
    const h = await headers({ enabled: true })

    expect(h['cross-origin-opener-policy']).toBe('same-origin')
    expect(h['cross-origin-resource-policy']).toBe('same-site')
  })

  it('can be changed', async () => {
    const h = await headers({
      enabled: true,
      crossOriginResourcePolicy: 'cross-origin',
      crossOriginOpenerPolicy: 'same-origin-allow-popups',
    })

    expect(h['cross-origin-resource-policy']).toBe('cross-origin')
    expect(h['cross-origin-opener-policy']).toBe('same-origin-allow-popups')
  })

  it('can be turned off', async () => {
    const h = await headers({
      enabled: true,
      crossOriginResourcePolicy: false,
      crossOriginOpenerPolicy: false,
    })

    expect(h['cross-origin-resource-policy']).toBeUndefined()
    expect(h['cross-origin-opener-policy']).toBeUndefined()
  })
})

describe('CORS default', () => {
  const evil = 'https://evil.example'
  const friend = 'https://app.example'
  const build = (options: any = {}, routes: any = {}) =>
    createTestApp(
      appWith(
        {
          ping: route.get('/ping', {
            public: true,
            handle: () => ({ ok: true }),
          }),
          ...routes,
        },
        options
      )
    )

  it('sends no CORS headers until an app asks for them', async () => {
    const res = await build().get('/ping').set('origin', evil)

    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('does not approve a preflight from another site', async () => {
    const res = await build()
      .options('/ping')
      .set('origin', evil)
      .set('access-control-request-method', 'GET')

    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('allows only the listed origins', async () => {
    const app = build({ cors: { origin: [friend] } })

    const listed = await app.get('/ping').set('origin', friend)
    const other = await app.get('/ping').set('origin', evil)

    expect(listed.headers['access-control-allow-origin']).toBe(friend)
    expect(other.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('still allows any site when an app says so', async () => {
    const res = await build({ cors: true }).get('/ping').set('origin', evil)

    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it("still applies a route's own CORS while the global setting is off", async () => {
    const app = build(
      {},
      {
        open: route.get('/open', {
          public: true,
          cors: { origin: [friend] },
          handle: () => ({ ok: true }),
        }),
      }
    )

    const open = await app.get('/open').set('origin', friend)
    const closed = await app.get('/ping').set('origin', friend)

    expect(open.headers['access-control-allow-origin']).toBe(friend)
    expect(closed.headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('a malformed Content-Type', () => {
  it('is not read as no Content-Type', () => {
    expect(mediaTypeOf('; ls -la')).toBe('; ls -la')
    expect(mediaTypeOf('   ')).toBe('')
  })
})

describe('Bun responses', () => {
  const respond = () => {
    let response: Response | undefined
    const res = new BunServerResponse((r: Response) => {
      response = r
    })
    return { res, get: () => response! }
  }

  it('has the once() that streamed responses call, which used to crash the process', () => {
    const { res } = respond()
    let closed = 0
    res.once('close', () => closed++)

    res.end('x')
    res.emit('close')

    expect(closed).toBe(1)
  })

  it('answers a 204 with no body, which used to throw', () => {
    const { res, get } = respond()

    res.statusCode = 204
    res.end()

    expect(get().status).toBe(204)
  })

  it('refuses a CRLF in a header', () => {
    const { res } = respond()

    expect(() => res.setHeader('location', 'x\r\nSet-Cookie: a=1')).toThrow()
    expect(() => res.setHeader('x-bad\r\nname', 'x')).toThrow()
  })

  it('treats header names as case-insensitive', () => {
    const { res, get } = respond()

    res.setHeader('Content-Type', 'text/plain')
    res.setHeader('content-type', 'application/json')
    res.end('{}')

    expect(res.getHeader('CONTENT-TYPE')).toBe('application/json')
    expect(get().headers.get('content-type')).toBe('application/json')
  })

  it('sends each cookie separately', () => {
    const { res, get } = respond()

    res.setHeader('set-cookie', ['a=1', 'b=2'])
    res.end('x')

    expect(get().headers.getSetCookie()).toEqual(['a=1', 'b=2'])
  })

  it('streams as it writes, so SSE events are not held back', async () => {
    const { res, get } = respond()

    res.setHeader('content-type', 'text/event-stream')
    res.write('data: 1\n\n')

    // Answered before end(), which is the point of streaming
    const reader = get().body!.getReader()
    const first = await reader.read()
    expect(Buffer.from(first.value!).toString()).toBe('data: 1\n\n')

    res.end()
    expect((await reader.read()).done).toBe(true)
  })

  it('reports a client that went away', async () => {
    const { res, get } = respond()
    let closed = false
    res.once('close', () => {
      closed = true
    })

    res.write('x')
    await get().body!.cancel()

    expect(closed).toBe(true)
    expect(res.destroyed).toBe(true)
    expect(res.write('y')).toBe(false)
  })
})

describe('Bun requests', () => {
  const fake = (headers: Record<string, string>, extra: any = {}) => ({
    method: 'GET',
    url: 'http://x/path?a=1',
    headers: new Headers(headers),
    ...extra,
  })

  it('reports the real client address, not localhost', () => {
    const req = new BunIncomingMessage(fake({}), '203.0.113.9')

    expect(req.socket.remoteAddress).toBe('203.0.113.9')
  })

  it('never claims localhost when it does not know', () => {
    expect(new BunIncomingMessage(fake({})).socket.remoteAddress).toBe('')
  })

  it('keeps headers on an object with no prototype', () => {
    const req = new BunIncomingMessage(fake({ constructor: 'x' }))

    expect(Object.getPrototypeOf(req.headers)).toBe(null)
    expect(req.headers.constructor as unknown).toBe('x')
  })

  it('does not crash when a client aborts a body nobody reads', async () => {
    const req = new BunIncomingMessage(
      fake(
        {},
        {
          method: 'POST',
          body: {},
          arrayBuffer: () => Promise.reject(new Error('aborted')),
        }
      )
    )
    let failed = false
    req.on('error', () => {
      failed = true
    })

    await new Promise((r) => setTimeout(r, 10))

    expect(failed).toBe(true)
  })
})
