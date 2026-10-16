// Conditional requests (RFC 9110 §13): ETag generation, If-None-Match /
// If-Modified-Since (304), If-Match / If-Unmodified-Since (412), 428, and
// the same rules for static files and downloads.
import fs from 'node:fs'
import path from 'node:path'
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  createTestApp,
} from '../src/testing'
import { App } from '../src/server/app'
import { serveStatic, compression } from '../src/middleware'
import {
  evaluatePreconditions,
  matchesETagList,
  acceptsEncoding,
  formatETag,
  generateETag,
  fileETag,
} from '../src/server/helpers/conditional'
import { createTempDir, writeTempFile, cleanupTempDir } from './helpers'

const T0 = Date.parse('2026-01-01T00:00:00Z')
const httpDate = (ms: number) => new Date(ms).toUTCString()

describe('Entity tag matching', () => {
  it('matches a single tag, a list, and tags containing commas', () => {
    expect(matchesETagList('"a"', '"a"', true, false)).toBe(true)
    expect(matchesETagList('"x", "a" , "y"', '"a"', true, false)).toBe(true)
    expect(matchesETagList('"x,a", "b"', '"x,a"', true, false)).toBe(true)
    expect(matchesETagList('"x,a"', '"a"', true, false)).toBe(false)
    expect(matchesETagList('"ab"', '"a"', true, false)).toBe(false)
  })

  it('weak comparison ignores W/, strong comparison never matches weak tags', () => {
    expect(matchesETagList('W/"a"', '"a"', true, false)).toBe(true)
    expect(matchesETagList('"a"', 'W/"a"', true, false)).toBe(true)
    expect(matchesETagList('W/"a"', '"a"', true, true)).toBe(false)
    expect(matchesETagList('"a"', 'W/"a"', true, true)).toBe(false)
    expect(matchesETagList('"a"', '"a"', true, true)).toBe(true)
  })

  it('* matches any existing representation only', () => {
    expect(matchesETagList('*', '"a"', true, true)).toBe(true)
    expect(matchesETagList(' * ', undefined, true, false)).toBe(true)
    expect(matchesETagList('*', '"a"', false, true)).toBe(false)
  })

  it('ignores malformed list elements', () => {
    expect(matchesETagList('garbage, "a"', '"a"', true, false)).toBe(true)
    expect(matchesETagList('"unterminated', '"a"', true, false)).toBe(false)
  })
})

describe('Precondition evaluation order (RFC 9110 §13.2.2)', () => {
  const current = { etag: '"v2"', lastModified: T0 }
  const evaluate = (method: string, headers: Record<string, string>) =>
    evaluatePreconditions(method, headers, current)

  it('If-None-Match: 304 for reads, 412 for writes', () => {
    expect(evaluate('GET', { 'if-none-match': '"v2"' })).toBe('not-modified')
    expect(evaluate('HEAD', { 'if-none-match': '"v2"' })).toBe('not-modified')
    expect(evaluate('PUT', { 'if-none-match': '"v2"' })).toBe('failed')
    expect(evaluate('GET', { 'if-none-match': '"v1"' })).toBe('ok')
  })

  it('If-None-Match takes precedence over If-Modified-Since', () => {
    const later = httpDate(T0 + 60_000)
    expect(
      evaluate('GET', { 'if-none-match': '"v1"', 'if-modified-since': later })
    ).toBe('ok')
  })

  it('If-Modified-Since: 304 when unchanged, only for GET/HEAD', () => {
    expect(evaluate('GET', { 'if-modified-since': httpDate(T0) })).toBe(
      'not-modified'
    )
    expect(evaluate('GET', { 'if-modified-since': httpDate(T0 - 1000) })).toBe(
      'ok'
    )
    expect(evaluate('POST', { 'if-modified-since': httpDate(T0) })).toBe('ok')
  })

  it('If-Match failing wins over a matching If-None-Match', () => {
    expect(
      evaluate('GET', { 'if-match': '"v1"', 'if-none-match': '"v2"' })
    ).toBe('failed')
  })

  it('If-Unmodified-Since applies only without If-Match', () => {
    const earlier = httpDate(T0 - 60_000)
    expect(evaluate('PUT', { 'if-unmodified-since': earlier })).toBe('failed')
    expect(
      evaluate('PUT', { 'if-match': '"v2"', 'if-unmodified-since': earlier })
    ).toBe('ok')
    expect(evaluate('PUT', { 'if-unmodified-since': httpDate(T0) })).toBe('ok')
  })

  it('ignores unparsable dates', () => {
    expect(evaluate('GET', { 'if-modified-since': 'yesterday' })).toBe('ok')
    expect(evaluate('PUT', { 'if-unmodified-since': 'nope' })).toBe('ok')
  })

  it('If-None-Match: * allows creating a resource that does not exist yet', () => {
    const headers = { 'if-none-match': '*' }
    expect(evaluatePreconditions('PUT', headers, { exists: false })).toBe('ok')
    expect(evaluatePreconditions('PUT', headers, { etag: '"v1"' })).toBe(
      'failed'
    )
  })
})

describe('ETag and Accept-Encoding helpers', () => {
  it('generates the same weak tag for a string and its bytes', () => {
    const tag = generateETag('héllo')
    expect(tag).toBe(generateETag(Buffer.from('héllo')))
    expect(tag.startsWith('W/"6-')).toBe(true)
    expect(generateETag('')).toBe('W/"0-2jmj7l5rsw0yVb/vlWAYkK/YBwk"')
  })

  it('quotes bare tags and rejects values that would break the header', () => {
    expect(formatETag('v3')).toBe('"v3"')
    expect(formatETag('W/"v3"')).toBe('W/"v3"')
    expect(() => formatETag('a"b')).toThrow(/Invalid ETag/)
    expect(() => formatETag('a\r\nX-Evil: 1')).toThrow(/Invalid ETag/)
  })

  it('honours q=0 and * in Accept-Encoding', () => {
    expect(acceptsEncoding('gzip, br', 'br')).toBe(true)
    expect(acceptsEncoding('br;q=0, gzip', 'br')).toBe(false)
    expect(acceptsEncoding('BR;Q=0.5', 'br')).toBe(true)
    expect(acceptsEncoding('*', 'gzip')).toBe(true)
    expect(acceptsEncoding('*;q=0', 'gzip')).toBe(false)
    expect(acceptsEncoding(undefined, 'gzip')).toBe(false)
  })
})

describe('Automatic ETags (etag: true)', () => {
  const app = new App({ etag: true })
  app.get('/item', () => ({ id: 1, name: 'Widget' }))
  app.get('/text', (_req: any, res: any) => res.send('plain'))
  app.post('/item', () => ({ created: true }))
  app.get('/missing', (_req: any, res: any) =>
    res.status(404).json({ error: 'nope' })
  )
  const client = createTestApp(app)

  it('answers a matching If-None-Match with a bare 304', async () => {
    const first = await client.get('/item')
    const etag = String(first.headers['etag'])
    expect(etag.startsWith('W/"')).toBe(true)

    const second = await client.get('/item').set('if-none-match', etag)
    expect(second.status).toBe(304)
    expect(second.text).toBe('')
    expect(second.headers['etag']).toBe(etag)
    expect(second.headers['content-type']).toBeUndefined()
    expect(second.headers['content-length']).toBeUndefined()
  })

  it('matches within a list, as a weak tag, and for HEAD', async () => {
    const etag = String((await client.get('/item')).headers['etag'])
    const listed = await client
      .get('/item')
      .set('if-none-match', `"other", ${etag}`)
    expect(listed.status).toBe(304)
    const head = await client.head('/item').set('if-none-match', etag)
    expect(head.status).toBe(304)
  })

  it('revalidates even with Cache-Control: no-cache in the request', async () => {
    const etag = String((await client.get('/text')).headers['etag'])
    const res = await client
      .get('/text')
      .set('if-none-match', etag)
      .set('cache-control', 'no-cache')
    expect(res.status).toBe(304)
  })

  it('sends the full response when the tag differs', async () => {
    const res = await client.get('/item').set('if-none-match', '"stale"')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 1, name: 'Widget' })
  })

  it('answers a failed If-Match on a read with 412 and the error envelope', async () => {
    const res = await client.get('/item').set('if-match', '"stale"')
    expect(res.status).toBe(412)
    expect(res.body.error.code).toBe('PRECONDITION_FAILED')
    expect(res.headers['etag']).toBeUndefined()
  })

  it('does not tag writes or error responses', async () => {
    expect((await client.post('/item')).headers['etag']).toBeUndefined()
    expect((await client.get('/missing')).headers['etag']).toBeUndefined()
  })
})

describe('res.checkPreconditions()', () => {
  let version = 1
  let updatedAt = T0
  let writes = 0
  const app = new App()
  app.get('/doc', (_req: any, res: any) => {
    if (
      res.checkPreconditions({ etag: `v${version}`, lastModified: updatedAt })
    ) {
      return
    }
    return { version }
  })
  app.put('/doc', (_req: any, res: any) => {
    res.checkPreconditions({ etag: `v${version}` }, { required: true })
    writes++
    version++
    updatedAt += 60_000
    res.setHeader('ETag', `"v${version}"`)
    return { version }
  })
  app.put('/new/:exists', (req: any, res: any) => {
    res.checkPreconditions({
      etag: '"v1"',
      exists: req.params.exists === 'yes',
    })
    res.status(201)
    return { created: true }
  })
  const client = createTestApp(app)

  it('GET sets the validators and answers 304 when current', async () => {
    const first = await client.get('/doc')
    expect(first.headers['etag']).toBe('"v1"')
    expect(first.headers['last-modified']).toBe(httpDate(T0))

    const byTag = await client.get('/doc').set('if-none-match', '"v1"')
    expect(byTag.status).toBe(304)
    const byDate = await client
      .get('/doc')
      .set('if-modified-since', httpDate(T0))
    expect(byDate.status).toBe(304)
  })

  it('PUT with the current tag succeeds and returns the new tag', async () => {
    const res = await client.put('/doc').set('if-match', `"v${version}"`)
    expect(res.status).toBe(200)
    expect(res.headers['etag']).toBe(`"v${version}"`)
  })

  it('PUT with a stale tag is refused with 412 before the write', async () => {
    const before = writes
    const res = await client.put('/doc').set('if-match', '"v1"')
    expect(res.status).toBe(412)
    expect(res.body.error.code).toBe('PRECONDITION_FAILED')
    expect(writes).toBe(before)
  })

  it('a write without any precondition is refused with 428 when required', async () => {
    const res = await client.put('/doc')
    expect(res.status).toBe(428)
    expect(res.body.error.code).toBe('PRECONDITION_REQUIRED')
  })

  it('If-None-Match: * creates only when the resource does not exist', async () => {
    const created = await client.put('/new/no').set('if-none-match', '*')
    expect(created.status).toBe(201)
    const exists = await client.put('/new/yes').set('if-none-match', '*')
    expect(exists.status).toBe(412)
  })

  it('req.fresh reflects the same rules', async () => {
    const app2 = new App()
    app2.get('/f', (req: any, res: any) => {
      res.setHeader('ETag', '"a"')
      return { fresh: req.fresh }
    })
    const c = createTestApp(app2)
    expect((await c.get('/f').set('if-none-match', 'W/"a"')).status).toBe(304)
    expect((await c.get('/f').set('if-none-match', '"b"')).body.fresh).toBe(
      false
    )
  })
})

describe('Static files and downloads', () => {
  let dir: string
  let file: string
  let client: ReturnType<typeof createTestApp>

  beforeAll(() => {
    dir = createTempDir('exis-conditional-')
    file = writeTempFile(dir, 'public/app.js', 'console.log(1)')
    writeTempFile(dir, 'public/app.js.br', 'BROTLI')
    fs.utimesSync(file, T0 / 1000, T0 / 1000)
    const app = new App()
    app.use(serveStatic(path.join(dir, 'public')))
    app.get('/dl', (_req: any, res: any) => res.download(file, 'app.js'))
    client = createTestApp(app)
  })

  afterAll(() => cleanupTempDir(dir))

  it('sends ETag, Last-Modified and Vary, then 304 on revalidation', async () => {
    const first = await client.get('/app.js')
    expect(first.text).toBe('console.log(1)')
    expect(first.headers['etag']).toBe(fileETag(14, T0))
    expect(first.headers['last-modified']).toBe(httpDate(T0))
    expect(String(first.headers['vary'])).toContain('Accept-Encoding')

    const byTag = await client
      .get('/app.js')
      .set('if-none-match', `"x", ${first.headers['etag']}`)
    expect(byTag.status).toBe(304)
    expect(byTag.headers['content-type']).toBeUndefined()

    const byDate = await client
      .get('/app.js')
      .set('if-modified-since', httpDate(T0 + 1000))
    expect(byDate.status).toBe(304)
  })

  it('serves the precompressed variant with its own ETag, and honours q=0', async () => {
    const br = await client.get('/app.js').set('accept-encoding', 'br, gzip')
    expect(br.headers['content-encoding']).toBe('br')
    expect(br.text).toBe('BROTLI')
    expect(br.headers['etag']).not.toBe(fileETag(14, T0))

    const refused = await client.get('/app.js').set('accept-encoding', 'br;q=0')
    expect(refused.headers['content-encoding']).toBeUndefined()
    expect(refused.text).toBe('console.log(1)')
  })

  it('answers a failed If-Match with 412', async () => {
    const res = await client.get('/app.js').set('if-match', '"other"')
    expect(res.status).toBe(412)
  })

  it('res.download(path) supports ETag and 304', async () => {
    const first = await client.get('/dl')
    expect(first.headers['etag']).toBe(fileETag(14, T0))
    const second = await client
      .get('/dl')
      .set('if-none-match', String(first.headers['etag']))
    expect(second.status).toBe(304)
    expect(second.headers['content-disposition']).toBeUndefined()
  })
})

describe('Compression negotiation', () => {
  it('does not use an encoding the client refused with q=0', async () => {
    const app = new App()
    app.use(compression())
    app.get('/big', () => ({ data: 'x'.repeat(5000) }))
    const res = await createTestApp(app)
      .get('/big')
      .set('accept-encoding', 'br;q=0, gzip')
    expect(res.headers['content-encoding']).toBe('gzip')
  })
})
