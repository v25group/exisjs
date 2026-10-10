import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { App } from '../src/server/app'
import { createTestApp } from '../src/testing/client'
import { download } from '../src/response'
import {
  route,
  type InferRouteInput,
  type InferRouteOutput,
} from '../src/router'
import { tex } from '../src/validator/index'
import { describe, expect, it } from '../src/testing'

describe('Returning files from handlers', () => {
  const app = new App({ logger: false })
  app.get('/report.csv', () => download('id,name\n1,Ada\n', 'report.csv'))
  app.get('/custom', () =>
    download(Buffer.from([1, 2, 3]), 'data.bin', {
      contentType: 'application/x-custom',
      headers: { 'Cache-Control': 'no-store' },
    })
  )
  app.get('/buffer', () => Buffer.from('raw bytes'))
  const client = createTestApp(app)

  it('download() sets attachment headers and infers the content type', async () => {
    const res = await client.get('/report.csv').expect(200)
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename=report.csv'
    )
    expect(String(res.headers['content-type']).startsWith('text/csv')).toBe(
      true
    )
    expect(res.text).toBe('id,name\n1,Ada\n')
  })

  it('download() honors contentType and extra headers', async () => {
    const res = await client.get('/custom').expect(200)
    expect(res.headers['content-type']).toBe('application/x-custom')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['content-length']).toBe('3')
  })

  it('a returned Buffer is sent as bytes, not JSON', async () => {
    const res = await client.get('/buffer').expect(200)
    expect(res.text).toBe('raw bytes')
    expect(res.headers['content-type']).toBe('application/octet-stream')
  })
})

describe('res.download() file paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exis-dl-'))
  const exportsDir = path.join(dir, 'exports')
  fs.mkdirSync(exportsDir)
  fs.writeFileSync(path.join(exportsDir, 'a.txt'), 'public file')
  const secret = path.join(dir, 'secret.txt')
  fs.writeFileSync(secret, 'TOP SECRET')

  const app = new App({ logger: false })
  app.get('/file', (_req, res) => {
    res.download(path.join(exportsDir, 'a.txt'), 'renamed.txt')
  })
  app.get('/rooted', (req, res) => {
    res.download(String(req.query.name), undefined, { root: exportsDir })
  })
  app.get('/string-is-a-path', (_req, res) => {
    res.download('id,name;1,Ada', 'report.csv')
  })
  // A content string that happens to equal an existing file path
  app.get('/content', () => download(secret, 'note.txt'))
  const client = createTestApp(app)

  it('streams a file from disk with its length', async () => {
    const res = await client.get('/file').expect(200)
    expect(res.text).toBe('public file')
    expect(res.headers['content-length']).toBe('11')
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename=renamed.txt'
    )
  })

  it('serves files inside root and names them after the file', async () => {
    const res = await client.get('/rooted?name=a.txt').expect(200)
    expect(res.text).toBe('public file')
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename=a.txt'
    )
  })

  it('answers 404 for paths escaping root', async () => {
    for (const name of [
      '../secret.txt',
      '..%2Fsecret.txt',
      encodeURIComponent(secret),
      'missing.txt',
      '.',
    ]) {
      const res = await client.get(`/rooted?name=${name}`)
      expect(res.status).toBe(404)
      expect(res.text.includes('TOP SECRET')).toBe(false)
      expect(res.headers['content-disposition']).toBe(undefined)
    }
  })

  it('treats a string as a path, never as content', async () => {
    await client.get('/string-is-a-path').expect(404)
  })

  it('download() sends a string as content even if it names a real file', async () => {
    const res = await client.get('/content').expect(200)
    expect(res.text).toBe(secret)
  })
})

describe('Shutdown signal', () => {
  it('passes the signal to onShutdown hooks', async () => {
    const app = new App({ logger: false })
    let received: string | undefined
    app.onShutdown((signal) => {
      received = signal
    })
    await app.close(1000, 'SIGTERM')
    expect(received).toBe('SIGTERM')
  })
})

describe('InferRouteInput / InferRouteOutput', () => {
  it('derive service types from a route definition', () => {
    const createUser = route.post('/users/:orgId', {
      body: tex.object({ name: tex.string(), age: tex.number() }),
      async handle({ body, params }) {
        return { id: 1, name: body.name, org: params.orgId }
      },
    })

    type Input = InferRouteInput<typeof createUser>
    type Output = InferRouteOutput<typeof createUser>

    // Compile-time checks: these assignments fail `npm run typecheck` if the
    // inferred types drift
    const input: Input = {
      body: { name: 'Ada', age: 36 },
      query: {},
      params: { orgId: 'acme' },
    }
    const output: Output = { id: 1, name: 'Ada', org: 'acme' }
    // @ts-expect-error age must be a number
    const bad: Input['body'] = { name: 'Ada', age: 'old' }

    expect(input.body.name).toBe('Ada')
    expect(output.org).toBe('acme')
    expect(bad.name).toBe('Ada')
  })
})
