// Attacks what attack.mjs can't reach: HTTP/2, slow connections, cluster mode,
// metrics, Swagger and SSE. Starts its own servers from the built example.
//
//   node scripts/security/attack-extra.mjs [--slow]
//
// --slow also waits for slow-connection timeouts (about 2 minutes). Needs
// `npm run build`, `exisjs build` in the example, openssl and MongoDB on
// localhost:27017. Only run this against your own machine.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import http2 from 'node:http2'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SLOW = process.argv.includes('--slow')
const results = []
const record = (group, name, ok, evidence = '') => {
  results.push({ group, ok })
  if (!ok) console.log(`  HOLE  [${group}] ${name}\n        ${evidence}`)
}
const note = (group, name, evidence) =>
  console.log(`  note  [${group}] ${name}: ${evidence}`)
const short = (t) =>
  String(t ?? '')
    .slice(0, 160)
    .replace(/\s+/g, ' ')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function startServer(port, env = {}, example = '06-secure-functional') {
  const cwd = path.join(ROOT, 'examples', example)
  const runtime =
    env.EXIS_SERVER === 'bun'
      ? (process.env.BUN_PATH ?? 'bun')
      : process.execPath
  const server = spawn(runtime, ['.exis/server/main.js'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      INSECURE_COOKIES: '1',
      LOG_LEVEL: 'fatal',
      MONGODB_URI: `mongodb://localhost:27017/exis_attack_extra_${port}`,
      ...env,
    },
  })
  const state = { server, output: '', exited: null, port }
  server.stdout.on('data', (c) => (state.output += c))
  server.stderr.on('data', (c) => (state.output += c))
  server.on('exit', (code, signal) => (state.exited = code ?? signal))
  return state
}

const stopServer = (state) =>
  new Promise((resolve) => {
    if (state.exited !== null) return resolve()
    state.server.once('exit', resolve)
    state.server.kill()
    setTimeout(resolve, 3000)
  })

function h1(port, method, url, { headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: url, headers, agent: false },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: Buffer.concat(chunks).toString(),
          })
        )
        res.on('error', () => resolve({ status: 0, headers: {}, text: '' }))
      }
    )
    req.setTimeout(15000, () => req.destroy(new Error('timeout')))
    req.on('error', (err) =>
      resolve({
        status: 0,
        headers: {},
        text: '',
        error: err.code ?? err.message,
      })
    )
    if (body !== undefined) req.write(body)
    req.end()
  })
}

const waitUp = async (check, state, ms = 25000) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline && state.exited === null) {
    if (await check().catch(() => false)) return true
    await sleep(250)
  }
  return false
}

const aliveH1 = (state, group, label = 'server still answers') =>
  h1(state.port, 'GET', '/health').then((r) =>
    record(
      group,
      label,
      r.status === 200,
      `status ${r.status} ${r.error ?? ''}; exited ${state.exited}; ${short(state.output.slice(-400))}`
    )
  )

// ─── HTTP/2 ─────────────────────────────────────────────────────────────────
function h2Connect(port) {
  return new Promise((resolve, reject) => {
    const session = http2.connect(`https://127.0.0.1:${port}`, {
      rejectUnauthorized: false,
    })
    session.once('connect', () => resolve(session))
    session.once('error', reject)
  })
}

function h2Request(session, headers, body) {
  return new Promise((resolve) => {
    let stream
    try {
      stream = session.request(headers, { endStream: body === undefined })
    } catch (err) {
      return resolve({
        status: 0,
        text: '',
        headers: {},
        error: err.code ?? err.message,
      })
    }
    const chunks = []
    let response = {}
    stream.on('response', (h) => (response = h))
    stream.on('data', (c) => chunks.push(c))
    stream.on('end', () =>
      resolve({
        status: response[':status'] ?? 0,
        headers: response,
        text: Buffer.concat(chunks).toString(),
      })
    )
    stream.on('error', (err) =>
      resolve({
        status: response[':status'] ?? 0,
        headers: response,
        text: Buffer.concat(chunks).toString(),
        error: err.code ?? err.message,
      })
    )
    stream.setTimeout(15000, () => stream.close())
    if (body !== undefined) stream.end(body)
  })
}

async function attackHttp2(certs, tlsPort) {
  const G = 'http2'
  const state = await startServer(tlsPort, {
    TLS_KEY: certs.key,
    TLS_CERT: certs.cert,
    KEEP_ALIVE_MS: '3000',
  })
  const up = await waitUp(async () => {
    const s = await h2Connect(tlsPort)
    const r = await h2Request(s, { ':path': '/health' })
    s.close()
    return r.status === 200
  }, state)
  record(
    G,
    'server starts with TLS and HTTP/2',
    up,
    short(state.output.slice(-500))
  )
  if (!up) return stopServer(state)

  const alive = async (label) => {
    const s = await h2Connect(tlsPort).catch(() => null)
    const r = s ? await h2Request(s, { ':path': '/health' }) : { status: 0 }
    s?.destroy()
    record(
      G,
      label,
      r.status === 200 && state.exited === null,
      `status ${r.status}; exited ${state.exited}; ${short(state.output.slice(-400))}`
    )
  }

  let s = await h2Connect(tlsPort)
  // Paths that skip auth (NestJS and Fastify) over HTTP/2
  for (const p of [
    '/admin/users',
    '/admin/users/',
    '//admin/users',
    '/admin//users',
    '/ADMIN/users',
    '/admin%2fusers',
    '/admin/secret',
    '/admin/secret/',
    '//admin/secret',
    '/x/../admin/secret',
  ]) {
    const r = await h2Request(s, { ':path': p })
    record(
      G,
      `anonymous ${p}`,
      !/ADMIN_ONLY_SECRET|admin@example/.test(r.text),
      `status ${r.status}: ${short(r.text)}`
    )
  }
  for (const [name, value] of [
    ['x-middleware-subrequest', 'middleware'],
    ['x-original-url', '/health'],
    ['x-http-method-override', 'OPTIONS'],
  ]) {
    const r = await h2Request(s, { ':path': '/admin/secret', [name]: value })
    record(
      G,
      `${name} over HTTP/2`,
      r.status === 401 || r.status === 403,
      `status ${r.status}`
    )
  }

  // A normal browser flow must work: Host comes from :authority on HTTP/2
  const origin = `https://127.0.0.1:${tlsPort}`
  const csrf = await h2Request(s, { ':path': '/auth/csrf' })
  const cookie = [csrf.headers['set-cookie'] ?? []]
    .flat()
    .map((c) => c.split(';')[0])
    .join('; ')
  const token = JSON.parse(csrf.text || '{}').csrfToken
  const post = (headers, body) =>
    h2Request(
      s,
      {
        ':method': 'POST',
        ':path': '/auth/register',
        'content-type': 'application/json',
        cookie,
        'x-csrf-token': token,
        ...headers,
      },
      body
    )
  const body = JSON.stringify({
    email: `h2-${Date.now()}@example.com`,
    name: 'x',
    password: 'a-long-enough-password',
  })
  const same = await post({ origin }, body)
  record(
    G,
    'same-origin POST works over HTTP/2',
    same.status === 201,
    `status ${same.status}: ${short(same.text)}`
  )
  const evil = await post({ origin: 'https://evil.example' }, body)
  record(
    G,
    'evil Origin is refused over HTTP/2',
    evil.status === 403,
    `status ${evil.status}`
  )
  const evilHost = await post(
    {
      origin: 'https://evil.example',
      ':authority': `127.0.0.1:${tlsPort}`,
      host: 'evil.example',
    },
    body
  )
  record(
    G,
    'Host header does not satisfy the Origin check',
    evilHost.status === 403,
    `status ${evilHost.status}: ${short(evilHost.text)}`
  )
  const proto = await h2Request(s, {
    ':path': '/health',
    __proto__x: 'x',
    constructor: 'x',
    hasownproperty: 'x',
  })
  record(
    G,
    'prototype-named headers',
    proto.status === 200,
    `status ${proto.status}`
  )
  const big = await post({}, JSON.stringify({ a: 'x'.repeat(2 * 1024 * 1024) }))
  record(
    G,
    'body over bodyLimit',
    big.status === 413 || big.status === 0,
    `status ${big.status} ${big.error ?? ''}`
  )
  await alive('answers after normal attacks')

  // Rapid reset, CVE-2023-44487: open and cancel streams as fast as possible
  s.destroy()
  s = await h2Connect(tlsPort)
  s.on('error', () => undefined)
  const started = Date.now()
  let cancelled = 0
  for (let i = 0; i < 20000 && !s.destroyed; i++) {
    try {
      const st = s.request({ ':path': '/health' })
      st.on('error', () => undefined)
      st.close(http2.constants.NGHTTP2_CANCEL)
      cancelled++
    } catch {
      break
    }
    if (i % 500 === 0) await sleep(0)
  }
  note(
    G,
    'rapid reset',
    `${cancelled} streams cancelled in ${Date.now() - started} ms; session ${s.destroyed ? 'closed by the server' : 'still open'}`
  )
  s.destroy()
  await alive('answers after a rapid reset flood')

  // Too many open streams, and streams that send nothing further
  s = await h2Connect(tlsPort)
  s.on('error', () => undefined)
  const open = []
  for (let i = 0; i < 2000 && !s.destroyed; i++) {
    try {
      const st = s.request(
        {
          ':method': 'POST',
          ':path': '/auth/register',
          'content-type': 'application/json',
        },
        { endStream: false }
      )
      st.on('error', () => undefined)
      open.push(st)
    } catch {
      break
    }
  }
  await sleep(500)
  note(G, 'open streams', `${open.length} requested`)
  await alive('answers with many half-open streams')
  s.destroy()

  // Header floods: HPACK bomb and CONTINUATION-style volume
  s = await h2Connect(tlsPort)
  s.on('error', () => undefined)
  const many = { ':path': '/health' }
  for (let i = 0; i < 3000; i++) many[`x-h${i}`] = 'y'.repeat(100)
  const flood = await h2Request(s, many)
  record(
    G,
    'huge header list is refused',
    flood.status !== 200,
    `status ${flood.status} ${flood.error ?? ''}`
  )
  s.destroy()
  s = await h2Connect(tlsPort)
  s.on('error', () => undefined)
  for (let i = 0; i < 5000 && !s.destroyed; i++) {
    try {
      s.ping(() => undefined)
    } catch {
      break
    }
  }
  for (let i = 0; i < 2000 && !s.destroyed; i++) {
    try {
      s.settings({ maxConcurrentStreams: 100 + (i % 10) })
    } catch {
      break
    }
  }
  await sleep(300)
  s.destroy()
  await alive('answers after PING and SETTINGS floods')

  // Many clients cancelling mid-body
  for (let i = 0; i < 100; i++) {
    const c = await h2Connect(tlsPort).catch(() => null)
    if (!c) break
    c.on('error', () => undefined)
    const st = c.request(
      {
        ':method': 'POST',
        ':path': '/auth/register',
        'content-type': 'application/json',
      },
      { endStream: false }
    )
    st.on('error', () => undefined)
    st.write('{"a":')
    c.destroy()
  }
  await alive('answers after clients vanish mid-body')

  // An idle session must not stay forever: each one holds a TLS connection
  const idle = await h2Connect(tlsPort)
  idle.on('error', () => undefined)
  const closed = await Promise.race([
    new Promise((resolve) => idle.once('close', () => resolve(true))),
    sleep(9000).then(() => false),
  ])
  record(
    G,
    'an idle session is closed',
    closed,
    'still open after 9 s with keepAlive.timeoutMs: 3000'
  )
  idle.destroy()

  // The same app must stay reachable over HTTPS with HTTP/1.1
  await stopServer(state)
}

// ─── Slow connections (slowloris) ───────────────────────────────────────────
async function attackSlow(port, engine) {
  const G = `slow-${engine}`
  const state = await startServer(
    port,
    engine === 'node' ? {} : { EXIS_SERVER: engine }
  )
  const up = await waitUp(
    async () => (await h1(port, 'GET', '/health')).status === 200,
    state
  )
  if (!up) {
    record(G, 'server starts', false, short(state.output.slice(-400)))
    return stopServer(state)
  }

  const openSockets = (count, payload) => {
    const sockets = []
    for (let i = 0; i < count; i++) {
      const socket = net.connect(port, '127.0.0.1')
      socket.closedAt = null
      socket.startedAt = Date.now()
      socket.on('connect', () => socket.write(payload))
      socket.on('data', (d) => (socket.received = (socket.received ?? '') + d))
      socket.on('error', () => undefined)
      socket.on('close', () => (socket.closedAt = Date.now()))
      sockets.push(socket)
    }
    return sockets
  }
  const partialHeaders = openSockets(
    300,
    `GET /health HTTP/1.1\r\nHost: x\r\nX-Slow: `
  )
  const partialBody = openSockets(
    100,
    `POST /auth/register HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"a":`
  )
  await sleep(1000)

  const start = Date.now()
  const during = await h1(port, 'GET', '/health')
  record(
    G,
    'answers others during 400 slow connections',
    during.status === 200,
    `status ${during.status} ${during.error ?? ''}`
  )
  note(G, 'response time under slow connections', `${Date.now() - start} ms`)

  if (SLOW) {
    await sleep(100_000)
    const report = (sockets) => {
      const closed = sockets.filter((s) => s.closedAt !== null)
      const times = closed.map((s) => s.closedAt - s.startedAt)
      return `${sockets.length - closed.length} of ${sockets.length} still open${closed.length ? `, closed at ${Math.min(...times)}-${Math.max(...times)} ms` : ''}, ${sockets.filter((s) => s.destroyed).length} destroyed, first bytes ${JSON.stringify(sockets[0].received?.slice(0, 30))}`
    }
    const headersOpen = partialHeaders.filter((s) => s.closedAt === null).length
    record(
      G,
      'slow headers are dropped within 100 s',
      headersOpen === 0,
      report(partialHeaders)
    )
    note(G, 'slow headers', report(partialHeaders))
    note(G, 'slow bodies', report(partialBody))
  }
  for (const s of [...partialHeaders, ...partialBody]) s.destroy()

  const flood = openSockets(3000, '')
  await sleep(1500)
  await aliveH1(state, G, 'answers after 3000 idle connections')
  for (const s of flood) s.destroy()
  await sleep(300)
  await aliveH1(state, G, 'answers after they all vanish')
  await stopServer(state)
}

// ─── Cluster mode ───────────────────────────────────────────────────────────
async function attackCluster(port) {
  const G = 'cluster'
  const state = await startServer(port, { EXIS_WORKERS: '2' })
  const up = await waitUp(
    async () => (await h1(port, 'GET', '/health')).status === 200,
    state
  )
  record(G, 'server starts with 2 workers', up, short(state.output.slice(-400)))
  if (!up) return stopServer(state)
  await sleep(4000)

  const attack = spawn(
    process.execPath,
    [
      path.join(ROOT, 'scripts', 'security', 'attack.mjs'),
      `http://127.0.0.1:${port}`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let out = ''
  attack.stdout.on('data', (c) => (out += c))
  attack.stderr.on('data', (c) => (out += c))
  const code = await new Promise((resolve) => attack.on('exit', resolve))
  const summary =
    out.match(/\d+ checks, \d+ holes/)?.[0] ?? short(out.slice(-300))
  record(
    G,
    'the full attack suite passes against a cluster',
    code === 0,
    `${summary}\n${out
      .split('\n')
      .filter((l) => /HOLE/.test(l))
      .slice(0, 8)
      .join('\n')}`
  )
  note(G, 'attack suite', summary)
  await aliveH1(state, G)
  await stopServer(state)
}

// ─── Metrics: an attacker must not be able to grow them without limit ───────
async function attackMetrics(port, engine) {
  const G = `metrics-${engine}`
  const state = await startServer(port, {
    EXIS_METRICS: '1',
    ...(engine === 'node' ? {} : { EXIS_SERVER: engine }),
  })
  const up = await waitUp(
    async () => (await h1(port, 'GET', '/health')).status === 200,
    state
  )
  if (!up) {
    record(G, 'server starts', false, short(state.output.slice(-400)))
    return stopServer(state)
  }
  const size = async () => (await h1(port, 'GET', '/metrics')).text.length
  const before = await size()
  for (let i = 0; i < 1500; i++)
    await h1(port, 'GET', `/unknown-${i}-${Math.random()}`)
  const afterPaths = await size()
  record(
    G,
    'unique URLs do not grow /metrics',
    afterPaths - before < 3000,
    `${before} -> ${afterPaths} bytes`
  )
  for (let i = 0; i < 300; i++) await h1(port, `M${i}X`, '/health')
  const afterMethods = await size()
  record(
    G,
    'unique HTTP methods do not grow /metrics',
    afterMethods - afterPaths < 3000,
    `${afterPaths} -> ${afterMethods} bytes`
  )
  const body = (await h1(port, 'GET', '/metrics')).text
  record(
    G,
    '/metrics names no secrets',
    !/mongodb:\/\/|password|secret/i.test(body),
    short(body)
  )
  note(
    G,
    '/metrics is open to anyone who can reach it',
    'keep it off the public internet'
  )
  await aliveH1(state, G)
  await stopServer(state)
}

// ─── Swagger and SSE ────────────────────────────────────────────────────────
async function attackDocsAndSse(port, engine = 'node') {
  const G = engine === 'node' ? 'docs-sse' : `docs-sse-${engine}`
  const state = await startServer(port, {
    EXIS_DOCS: '1',
    ...(engine === 'node' ? {} : { EXIS_SERVER: engine }),
  })
  const up = await waitUp(
    async () => (await h1(port, 'GET', '/health')).status === 200,
    state
  )
  if (!up) {
    record(G, 'server starts', false, short(state.output.slice(-400)))
    return stopServer(state)
  }
  const docs = await h1(
    port,
    'GET',
    `/docs?x=${encodeURIComponent('"><script>alert(1)</script>')}`
  )
  record(G, 'docs page is served', docs.status === 200, `status ${docs.status}`)
  record(
    G,
    'docs page does not reflect the query',
    !/<script>alert/.test(docs.text),
    short(docs.text)
  )
  const hasExternal = /<script[^>]+src="https?:/.test(docs.text)
  if (hasExternal)
    record(
      G,
      'external docs script has integrity',
      /integrity="sha(256|384|512)-/.test(docs.text),
      short(docs.text.match(/<script[\s\S]{0,300}/)?.[0])
    )
  record(
    G,
    'docs page has a CSP',
    Boolean(docs.headers['content-security-policy']),
    'no header'
  )
  record(
    G,
    'docs page refuses framing',
    Boolean(docs.headers['x-frame-options']) ||
      /frame-ancestors/.test(docs.headers['content-security-policy'] ?? ''),
    'no header'
  )
  for (const p of [
    '/docs/../.secret',
    '/docs/%2e%2e/.secret',
    '/docs/json/../../.secret',
    '/docs//.secret',
  ]) {
    const r = await h1(port, 'GET', p)
    record(
      G,
      `docs path ${p}`,
      !/STATIC_DOTFILE_LEAKED/.test(r.text),
      `status ${r.status}`
    )
  }
  const spec = await h1(port, 'GET', '/docs/json')
  record(
    G,
    'spec has no secrets',
    !/mongodb:\/\/|passwordHash|CSRF_SECRET/.test(spec.text),
    short(spec.text)
  )
  note(
    G,
    'docs and the spec are public when enabled',
    'keep docs off in production'
  )

  // Client text must not start a new event or field
  const sse = async (q) =>
    (await h1(port, 'GET', `/hello/stream?msg=${encodeURIComponent(q)}`)).text
  for (const [name, payload] of [
    ['LF', 'hi\n\nevent: admin\ndata: injected'],
    ['CR', 'hi\r\revent: admin\rdata: injected'],
    ['CRLF', 'hi\r\n\r\nevent: admin\r\ndata: injected'],
  ]) {
    const text = await sse(payload)
    const injectedEvent = /(^|[\r\n])event: admin/.test(
      text.replace(/data: /g, '')
    )
      ? /(^|[\r\n])event: admin/.test(text)
      : false
    record(
      G,
      `SSE data with ${name}`,
      !injectedEvent,
      JSON.stringify(text).slice(0, 200)
    )
    const field = await h1(
      port,
      'GET',
      `/hello/stream?event=${encodeURIComponent(payload)}&msg=x`
    )
    record(
      G,
      `SSE event name with ${name}`,
      !/(^|[\r\n])event: admin/.test(field.text) && field.status < 500,
      JSON.stringify(field.text).slice(0, 200)
    )
    const id = await h1(
      port,
      'GET',
      `/hello/stream?id=${encodeURIComponent(payload)}&msg=x`
    )
    record(
      G,
      `SSE id with ${name}`,
      !/(^|[\r\n])event: admin/.test(id.text) && id.status < 500,
      JSON.stringify(id.text).slice(0, 200)
    )
  }
  await aliveH1(state, G)
  await stopServer(state)
}

// ─── Run ────────────────────────────────────────────────────────────────────
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exis-attack-'))
const certs = {
  key: path.join(certDir, 'key.pem'),
  cert: path.join(certDir, 'cert.pem'),
}
const made = spawnSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    certs.key,
    '-out',
    certs.cert,
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
  ],
  { stdio: 'ignore' }
)
if (made.status !== 0) {
  console.error('openssl is needed for the HTTP/2 attacks')
  process.exit(2)
}

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7)
const want = (name) => !only || only.split(',').includes(name)
if (want('docs')) await attackDocsAndSse(4720)
if (want('metrics')) await attackMetrics(4721, 'node')
if (want('metrics')) await attackMetrics(4722, 'uws')
if (want('http2')) await attackHttp2(certs, 4723)
if (want('slow')) await attackSlow(4724, 'node')
if (want('slow')) await attackSlow(4725, 'uws')
if (want('cluster')) await attackCluster(4726)
// Needs Bun: BUN_PATH names it if it isn't on PATH
if (want('bun')) {
  await attackDocsAndSse(4727, 'bun')
  await attackMetrics(4728, 'bun')
  await attackSlow(4729, 'bun')
}

fs.rmSync(certDir, { recursive: true, force: true })

const byGroup = new Map()
for (const r of results) {
  const g = byGroup.get(r.group) ?? { total: 0, holes: 0 }
  g.total++
  if (!r.ok) g.holes++
  byGroup.set(r.group, g)
}
console.log('\nGroup                  Checks  Holes')
for (const [name, g] of byGroup)
  console.log(
    `${name.padEnd(22)} ${String(g.total).padStart(6)} ${String(g.holes).padStart(6)}`
  )
const holes = results.filter((r) => !r.ok).length
console.log(`\n${results.length} checks, ${holes} holes`)
process.exit(holes > 0 ? 1 : 0)
