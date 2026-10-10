import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { Socket } from 'node:net'
import { App } from '../src/server/app'
import { ExisRequest } from '../src/server/request'
import { createTestApp } from '../src/testing/client'
import { secureJsonParse } from '../src/server/helpers/json'
import { safeUploadPath } from '../src/server/helpers/upload-name'
import { JSRadixTree } from '../src/router/radix'
import { createMockResponse } from './helpers'
import { describe, expect, it } from '../src/testing'

const boundary = '----exisHardeningBoundary'

function multipartRequest(payload: string, bodyLimit?: number): ExisRequest {
  const readable = new Readable({
    read() {
      this.push(Buffer.from(payload))
      this.push(null)
    },
  })
  Object.assign(readable, {
    method: 'POST',
    url: '/upload',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    socket: new Socket(),
  })
  return new ExisRequest(
    readable as any,
    createMockResponse() as any,
    false,
    bodyLimit
  )
}

function filePart(field: string, filename: string, content: string): string {
  return (
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
    `Content-Type: text/plain\r\n\r\n` +
    `${content}\r\n`
  )
}

describe('Hardening: uploads', () => {
  it('never lets the field name or filename escape the destination', () => {
    const dir = path.join(os.tmpdir(), 'exis-upload-root')
    const dest = safeUploadPath(dir, '../../../etc/evil', '../../x.php')
    expect(path.dirname(dest)).toBe(path.resolve(dir))
    expect(path.basename(dest).includes('..')).toBe(false)
    expect(dest.endsWith('.php')).toBe(true)
  })

  it('streamUpload keeps traversal field names inside destDir', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exis-up-'))
    const req = multipartRequest(
      filePart('../../escape', 'a.txt', 'hello') + `--${boundary}--\r\n`
    )
    const res = await req.streamUpload(dir)
    expect(res.files.length).toBe(1)
    expect(path.dirname(res.files[0].destPath)).toBe(path.resolve(dir))
    expect(fs.readFileSync(res.files[0].destPath, 'utf8')).toBe('hello')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('rejects multipart bodies whose files together exceed bodyLimit', async () => {
    const chunk = 'x'.repeat(600)
    const req = multipartRequest(
      filePart('a', 'a.txt', chunk) +
        filePart('b', 'b.txt', chunk) +
        `--${boundary}--\r\n`,
      1000
    )
    let status = 0
    try {
      await req.formData()
    } catch (err: any) {
      status = err.statusCode
    }
    expect(status).toBe(413)
  })
})

describe('Hardening: JSON bodies', () => {
  it('drops __proto__ and constructor keys, including escaped ones', () => {
    const parsed: any = secureJsonParse(
      '{"a":1,"__proto__":{"polluted":true},"nested":{"\\u005f_proto__":{"x":1},"constructor":{"prototype":{"y":1}}}}'
    )
    expect(parsed.a).toBe(1)
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(
      false
    )
    expect(
      Object.prototype.hasOwnProperty.call(parsed.nested, '__proto__')
    ).toBe(false)
    expect(
      Object.prototype.hasOwnProperty.call(parsed.nested, 'constructor')
    ).toBe(false)
    expect(({} as any).polluted).toBe(undefined)
  })
})

describe('Hardening: router', () => {
  it('gives every request its own params object', () => {
    const tree = new JSRadixTree()
    tree.insert('GET', '/user/:id', { path: '/user/:id' } as any)
    const first = tree.search('GET', '/user/1')!
    ;(first.params as any).id = 'tampered'
    const second = tree.search('GET', '/user/1')!
    expect(second.params.id).toBe('1')
  })

  it('prefers static segments regardless of registration order', () => {
    const tree = new JSRadixTree()
    for (const p of ['/stock/:id', '/stock/*rest', '/stock/kpis']) {
      tree.insert('GET', p, { path: p } as any)
    }
    tree.insert('POST', '/stock/:id', { path: 'POST /stock/:id' } as any)
    expect(tree.search('GET', '/stock/kpis')!.route.path).toBe('/stock/kpis')
    expect(tree.search('GET', '/stock/42')!.route.path).toBe('/stock/:id')
    expect(tree.search('GET', '/stock/a/b')!.route.path).toBe('/stock/*rest')
    // The static node has no POST route, so the param route still matches
    expect(tree.search('POST', '/stock/kpis')!.params.id).toBe('kpis')
  })

  it('keeps the param names each route declared at a shared position', () => {
    const tree = new JSRadixTree()
    tree.insert('GET', '/stock/:id', { path: 'a' } as any)
    tree.insert('GET', '/stock/:stockId/items', { path: 'b' } as any)
    expect(tree.search('GET', '/stock/5')!.params).toEqual({ id: '5' })
    expect(tree.search('GET', '/stock/5/items')!.params).toEqual({
      stockId: '5',
    })
  })

  it('answers malformed percent-encoding with 400, not 500', async () => {
    const app = new App({ logger: false })
    app.get('/user/:id', (req, res) => {
      res.json({ id: req.params.id })
    })
    const res = await createTestApp(app).get('/user/%E0%A4%A')
    expect(res.status).toBe(400)
  })
})

describe('Hardening: headers', () => {
  it('helmet: { enabled: false } disables security headers', async () => {
    const app = new App({ logger: false, helmet: { enabled: false } })
    app.get('/', (_req, res) => {
      res.json({ ok: true })
    })
    const res = await createTestApp(app).get('/')
    expect(res.headers['x-frame-options']).toBe(undefined)
  })

  it('helmet xFrameOptions config is applied', async () => {
    const app = new App({
      logger: false,
      helmet: { xFrameOptions: 'SAMEORIGIN' },
    })
    app.get('/', (_req, res) => {
      res.json({ ok: true })
    })
    const res = await createTestApp(app).get('/')
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
  })

  it('CORS with an origin allow-list sends Vary: Origin', async () => {
    const app = new App({
      logger: false,
      cors: { origin: ['https://a.example'] },
    })
    app.get('/', (_req, res) => {
      res.json({ ok: true })
    })
    const res = await createTestApp(app)
      .get('/')
      .set('Origin', 'https://a.example')
    expect(res.headers['access-control-allow-origin']).toBe('https://a.example')
    expect(String(res.headers['vary']).includes('Origin')).toBe(true)
  })

  it('replaces unsafe client-supplied request IDs', async () => {
    const app = new App({ logger: false })
    app.get('/', (_req, res) => {
      res.json({ ok: true })
    })
    const ok = await createTestApp(app).get('/').set('X-Request-Id', 'abc-123')
    expect(ok.headers['x-request-id']).toBe('abc-123')
    const bad = await createTestApp(app)
      .get('/')
      .set('X-Request-Id', 'a'.repeat(500))
    expect(String(bad.headers['x-request-id']).startsWith('req-')).toBe(true)
  })
})
