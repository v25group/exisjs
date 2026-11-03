// Attacks a running example app the way a hacker would, to find holes in the
// framework. Each group comes from a real class of bug in a real framework:
// path tricks that skip auth (NestJS, Fastify), Content-Type tricks that skip
// validation (Fastify), internal headers that skip middleware (Next.js), and a
// __proto__ header that crashes the server (Node.js).
//
//   node scripts/security/attack.mjs http://127.0.0.1:4706
//
// Only run this against a local server you own. Exit code 1 when a hole is found.
import http from 'node:http'
import net from 'node:net'

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:4706')
const HOST = base.hostname
const PORT = Number(base.port)
const ADMIN = {
  email: process.env.ADMIN_EMAIL ?? 'admin@example.com',
  password: process.env.ADMIN_PASSWORD ?? 'correct-horse-battery-staple',
}

const results = []
const record = (group, name, ok, evidence = '') => {
  results.push({ group, name, ok, evidence })
  if (!ok) console.log(`  HOLE  [${group}] ${name}\n        ${evidence}`)
}
const info = (group, name, evidence) => {
  results.push({ group, name, ok: true, info: true, evidence })
  console.log(`  note  [${group}] ${name}: ${evidence}`)
}
const short = (text) =>
  String(text ?? '')
    .slice(0, 160)
    .replace(/\s+/g, ' ')

// node:http sends the path as written, so nothing normalizes it for us
function send(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: HOST, port: PORT, method, path, headers, agent: false },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString()
          let json
          try {
            json = JSON.parse(text)
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json })
        })
        res.on('error', () =>
          resolve({ status: 0, headers: {}, text: '', error: 'aborted' })
        )
      }
    )
    req.setTimeout(20000, () => req.destroy(new Error('timeout')))
    req.on('error', (err) =>
      resolve({ status: 0, headers: {}, text: '', error: err.message })
    )
    if (body !== undefined) req.write(body)
    req.end()
  })
}

// A runtime may add its own 400 before closing the connection, as Bun does.
// Smuggling means a second request got an answer, so a later status other than
// 400 is what counts.
const answeredAnotherRequest = (res) =>
  (res.text.match(/HTTP\/1\.[01] \d{3}/g) ?? [])
    .slice(1)
    .some((line) => !line.endsWith(' 400'))

// For requests node:http refuses to send
function rawSend(payload, waitMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect(PORT, HOST)
    let data = ''
    const finish = () => {
      socket.destroy()
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(data)?.[1] ?? 0)
      resolve({
        status,
        text: data,
        responses: (data.match(/HTTP\/1\.[01] \d{3}/g) ?? []).length,
      })
    }
    socket.on('connect', () => socket.write(payload))
    socket.on('data', (c) => (data += c.toString('latin1')))
    socket.on('close', finish)
    socket.on('error', finish)
    setTimeout(finish, waitMs)
  })
}

class Browser {
  cookies = new Map()
  csrf = undefined

  async start() {
    const res = await this.req('GET', '/auth/csrf')
    this.csrf =
      res.json?.csrfToken ?? this.cookies.get('csrf-token')?.split('.')[0]
    return this
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  async req(method, path, opts = {}) {
    const headers = { ...(opts.headers ?? {}) }
    if (this.cookies.size > 0) headers.cookie ??= this.cookieHeader()
    if (this.csrf && !opts.noCsrf && !['GET', 'HEAD'].includes(method)) {
      headers['x-csrf-token'] ??= this.csrf
    }
    let body = opts.body
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json)
      headers['content-type'] ??= 'application/json'
    }
    if (body !== undefined)
      headers['content-length'] ??= Buffer.byteLength(body)
    const res = await send(method, path, { headers, body })
    for (const line of [res.headers['set-cookie'] ?? []].flat()) {
      const [pair] = line.split(';')
      const eq = pair.indexOf('=')
      const value = pair.slice(eq + 1)
      if (value === '' || /max-age=0/i.test(line)) {
        this.cookies.delete(pair.slice(0, eq))
      } else this.cookies.set(pair.slice(0, eq), value)
    }
    return res
  }
}

// A server may answer 413 and close while the client is still sending, so the
// client sees either the status or a reset. Both refuse; accepting it doesn't.
const refusedAsTooLarge = (res) =>
  res.status === 413 || /ECONNRESET|EPIPE|socket hang up/.test(res.error ?? '')

const multipart = (parts) => {
  const boundary = 'ExisAttackBoundary'
  const body = parts
    .map(({ name, filename, type, value }) => {
      const disposition = `form-data; name="${name}"${filename === undefined ? '' : `; filename="${filename}"`}`
      return `--${boundary}\r\nContent-Disposition: ${disposition}\r\n${type ? `Content-Type: ${type}\r\n` : ''}\r\n${value}\r\n`
    })
    .join('')
  return {
    body: `${body}--${boundary}--\r\n`,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

async function assertAlive(group) {
  const res = await send('GET', '/health')
  record(
    group,
    'server still answers after this group',
    res.status === 200,
    `status ${res.status} ${res.error ?? ''}`
  )
}

async function signUp(email) {
  const browser = await new Browser().start()
  const password = 'a-long-enough-password'
  const reg = await browser.req('POST', '/auth/register', {
    json: { email, name: email, password },
  })
  if (reg.status !== 201)
    throw new Error(`register failed: ${reg.status} ${reg.text}`)
  const login = await browser.req('POST', '/auth/login', {
    json: { email, password },
  })
  if (login.status !== 200)
    throw new Error(`login failed: ${login.status} ${login.text}`)
  browser.sessionCookieLine =
    [login.headers['set-cookie'] ?? []]
      .flat()
      .find((c) => c.startsWith('session=')) ?? ''
  await browser.start()
  return browser
}

const run = Date.now().toString(36)
const health = await send('GET', '/health')
if (health.status !== 200) {
  console.error(`No server at ${base} (${health.status} ${health.error ?? ''})`)
  process.exit(2)
}

const alice = await signUp(`alice-${run}@example.com`)
const bob = await signUp(`bob-${run}@example.com`)
const admin = await new Browser().start()
const adminLogin = await admin.req('POST', '/auth/login', { json: ADMIN })
if (adminLogin.status !== 200)
  throw new Error(`admin login: ${adminLogin.status}`)
await admin.start()
const anon = await new Browser().start()

const firstSessionCookie = alice.sessionCookieLine
{
  const wrongPass = await anon.req('POST', '/auth/login', {
    json: { email: ADMIN.email, password: 'wrong-password' },
  })
  const noUser = await anon.req('POST', '/auth/login', {
    json: { email: 'nobody@example.com', password: 'wrong-password' },
  })
  record(
    'info-leak',
    'login does not reveal which accounts exist',
    wrongPass.status === 401 &&
      noUser.status === 401 &&
      wrongPass.text === noUser.text,
    `${wrongPass.status} ${short(wrongPass.text)} / ${noUser.status} ${short(noUser.text)}`
  )
}

// The suite is only meaningful if the normal paths work
const controlAdmin = await admin.req('GET', '/admin/users')
const controlNote = await alice.req('POST', '/notes', {
  json: { title: 'control', body: 'x' },
})
const noteId = controlNote.json?.id
record(
  'control',
  'admin reaches /admin/users',
  controlAdmin.status === 200,
  `status ${controlAdmin.status}`
)
record(
  'control',
  'alice creates a note',
  controlNote.status === 201,
  `status ${controlNote.status} ${short(controlNote.text)}`
)
record(
  'control',
  'alice is refused /admin/users',
  (await alice.req('GET', '/admin/users')).status === 403
)
record(
  'control',
  'anonymous is refused /admin/users',
  [401, 403].includes((await anon.req('GET', '/admin/users')).status)
)
record(
  'control',
  'static file is served',
  (await send('GET', '/index.html')).status === 200
)

// ─── 1. Path tricks that skip auth (NestJS CVE-2026-54281, Fastify CVE-2026-33808) ───
{
  const G = 'auth-path-bypass'
  const variants = (p) => [
    `${p}/`,
    `/${p}`,
    p.replace('/admin/', '/admin//'),
    `${p}//`,
    p.replace('/admin', '/ADMIN'),
    p.replace('/admin', '/Admin'),
    p.replace('/admin', '/%61dmin'),
    p.replace('/admin/', '/admin%2f'),
    p.replace('/admin/', '/admin%2F'),
    p.replace('/admin/', '/admin/./'),
    p.replace('/admin/', '/admin/x/../'),
    `/x/..${p}`,
    p.replace('/admin/', '/admin\\'),
    p.replace('/admin/', '/admin%5c'),
    `${p};x=1`,
    `${p}%00`,
    `${p}%20`,
    `${p}.json`,
    `${p}?x=/health`,
    `/health/..${p}`,
    `/health/%2e%2e${p}`,
    `/health/..;${p}`,
    `http://${HOST}${p}`,
  ]
  for (const target of ['/admin/users', '/admin/secret']) {
    for (const path of variants(target)) {
      for (const [who, client] of [
        ['anonymous', anon],
        ['alice', alice],
      ]) {
        const res = await client.req('GET', path)
        const leaked = /ADMIN_ONLY_SECRET|admin@example\.com/.test(res.text)
        record(
          G,
          `${who} GET ${path}`,
          !leaked,
          `status ${res.status}: ${short(res.text)}`
        )
      }
    }
    for (const method of ['HEAD', 'OPTIONS', 'QUERY', 'TRACE', 'PROPFIND']) {
      const res = await anon.req(method, target)
      record(
        G,
        `anonymous ${method} ${target}`,
        !(res.status >= 200 && res.status < 300 && method !== 'OPTIONS') &&
          !/ADMIN_ONLY_SECRET/.test(res.text),
        `status ${res.status}`
      )
    }
  }
  await assertAlive(G)
}

// ─── 2. Headers that skip middleware (Next.js CVE-2025-29927) ────────────────
{
  const G = 'header-bypass'
  const attempts = {
    'x-middleware-subrequest':
      'middleware:middleware:middleware:middleware:middleware',
    'x-original-url': '/health',
    'x-rewrite-url': '/health',
    'x-forwarded-for': '127.0.0.1',
    'x-real-ip': '127.0.0.1',
    'x-forwarded-host': 'localhost',
    'x-forwarded-proto': 'https',
    'x-forwarded-prefix': '/health',
    'x-http-method-override': 'OPTIONS',
    'x-internal': 'true',
    'x-user': 'admin',
    'x-user-id': '1',
    'x-role': 'admin',
    'x-exis-user': 'admin',
    'x-exis-internal': '1',
    'x-exis-bypass': '1',
  }
  for (const [header, value] of Object.entries(attempts)) {
    for (const target of ['/admin/users', '/admin/secret', '/auth/me']) {
      const res = await anon.req('GET', target, {
        headers: { [header]: value },
      })
      record(
        G,
        `${header} on ${target}`,
        res.status === 401 || res.status === 403,
        `status ${res.status}: ${short(res.text)}`
      )
    }
  }
  for (const auth of [
    'Bearer x',
    'Basic YWRtaW46YWRtaW4=',
    'Bearer null',
    'Bearer undefined',
  ]) {
    const res = await anon.req('GET', '/admin/users', {
      headers: { authorization: auth },
    })
    record(
      G,
      `Authorization: ${auth}`,
      res.status === 401 || res.status === 403,
      `status ${res.status}`
    )
  }
  for (const cookie of [
    'session=',
    'session=undefined',
    'session=null',
    'session[$ne]=1',
    'session=%00',
    'session=' + 'a'.repeat(5000),
    '__proto__=x; session=y',
    'session={"$ne":null}',
  ]) {
    const res = await send('GET', '/auth/me', { headers: { cookie } })
    record(
      G,
      `Cookie: ${cookie.slice(0, 40)}`,
      res.status === 401 || res.status === 400,
      `status ${res.status}: ${short(res.text)}`
    )
  }
  await assertAlive(G)
}

// ─── 3. Content-Type tricks that skip validation (Fastify CVE-2026-25223) ────
{
  const G = 'content-type-bypass'
  const invalid = JSON.stringify({ title: 123, body: { $gt: '' } })
  for (const type of [
    'application/json',
    'application/json\tfoo',
    ' application/json',
    'APPLICATION/JSON',
    'application/json; charset=utf-7',
    'application/json;',
    'application/jsonfoo',
    'application/foo+json',
    'text/plain',
    'text/json',
    'application/x-www-form-urlencoded',
    'application/xml',
    'multipart/form-data',
    'multipart/form-data; boundary=x',
    'application/json, multipart/form-data',
    'text/plain; x=multipart/form-data; boundary=x',
    'text/plain; x=application/x-www-form-urlencoded',
  ]) {
    const res = await alice.req('POST', '/notes', {
      body: invalid,
      headers: { 'content-type': type },
    })
    record(
      G,
      `invalid body as "${type.replace(/\t/g, '\\t')}"`,
      res.status !== 201 && res.status < 500,
      `status ${res.status}: ${short(res.text)}`
    )
  }
  const none = await alice.req('POST', '/notes', { body: invalid })
  record(
    G,
    'invalid body with no Content-Type',
    none.status !== 201 && none.status < 500,
    `status ${none.status}`
  )

  // A browser sends text/plain cross-site with no preflight. A JSON API that
  // accepts it can be driven from another site (the CSRF route into an API).
  const valid = JSON.stringify({ title: 'cross-site', body: 'x' })
  for (const type of [
    'text/plain',
    'text/plain; charset=utf-8',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
  ]) {
    const res = await alice.req('POST', '/notes', {
      body: valid,
      headers: { 'content-type': type },
    })
    record(
      G,
      `valid JSON accepted as simple type "${type}"`,
      res.status !== 201,
      `status ${res.status}: ${short(res.text)}`
    )
  }
  await assertAlive(G)
}

// ─── 4. Input injection: NoSQL, mass assignment, prototype pollution ─────────
{
  const G = 'injection'
  for (const payload of [
    { email: { $ne: null }, password: { $ne: null } },
    { email: { $gt: '' }, password: 'x' },
    { email: ADMIN.email, password: { $ne: '' } },
    { email: [ADMIN.email], password: 'x' },
    { 'email.$ne': 'x', password: 'x' },
  ]) {
    const res = await anon.req('POST', '/auth/login', { json: payload })
    record(
      G,
      `login ${JSON.stringify(payload).slice(0, 50)}`,
      res.status === 400 || res.status === 401,
      `status ${res.status}: ${short(res.text)}`
    )
  }
  for (const qs of [
    'q[$ne]=x',
    'q[$regex]=.*',
    'q=a&q=b',
    'q=%00',
    'q.$ne=x',
  ]) {
    const res = await alice.req('GET', `/notes/search?${qs}`)
    record(
      G,
      `search ?${qs}`,
      res.status < 500 &&
        !(res.json ?? []).some?.((n) => n.title === 'bob-secret'),
      `status ${res.status}`
    )
  }
  for (const id of [
    '%7B%22$ne%22:null%7D',
    '[$ne]',
    'null',
    'undefined',
    '000',
    `${noteId}%00`,
    `${noteId}x`,
  ]) {
    const res = await bob.req('GET', `/notes/${id}`)
    record(
      G,
      `note id ${id}`,
      res.status === 400 || res.status === 404,
      `status ${res.status}: ${short(res.text)}`
    )
  }

  const mass = await anon.req('POST', '/auth/register', {
    json: {
      email: `mass-${run}@example.com`,
      name: 'x',
      password: 'a-long-enough-password',
      role: 'admin',
      roles: ['admin'],
      isAdmin: true,
      passwordHash: 'x',
      _id: 'x',
    },
  })
  record(
    G,
    'mass assignment of role at register',
    mass.status === 400 || mass.json?.role === 'user',
    `status ${mass.status}: ${short(mass.text)}`
  )

  const massNote = await alice.req('POST', '/notes', {
    json: { title: 't', body: 'b', ownerId: 'someone-else', _id: 'x' },
  })
  record(
    G,
    'mass assignment of ownerId on a note',
    massNote.status === 400 || massNote.status === 201,
    `status ${massNote.status}`
  )
  if (massNote.status === 201) {
    const mine = await alice.req('GET', `/notes/${massNote.json.id}`)
    record(
      G,
      'ownerId stays the signed-in user',
      mine.status === 200,
      `status ${mine.status}`
    )
  }

  for (const raw of [
    '{"__proto__":{"role":"admin","polluted":"yes"},"email":"p1@example.com","name":"x","password":"a-long-enough-password"}',
    '{"constructor":{"prototype":{"polluted":"yes"}},"email":"p2@example.com","name":"x","password":"a-long-enough-password"}',
    '{"\\u005f_proto__":{"role":"admin"},"email":"p3@example.com","name":"x","password":"a-long-enough-password"}',
    '{"email":"p4@example.com","email":"admin@example.com","name":"x","password":"a-long-enough-password"}',
  ]) {
    const res = await anon.req('POST', '/auth/register', {
      body: raw,
      headers: { 'content-type': 'application/json' },
    })
    record(
      G,
      `prototype key ${raw.slice(0, 30)}`,
      res.status < 500 &&
        res.json?.role !== 'admin' &&
        !/polluted/.test(res.text),
      `status ${res.status}: ${short(res.text)}`
    )
  }
  await assertAlive(G)
}

// ─── 5. Broken access between users ──────────────────────────────────────────
{
  const G = 'idor'
  await bob.req('POST', '/notes', { json: { title: 'bob-secret', body: 'x' } })
  record(
    G,
    'bob reads alice’s note',
    (await bob.req('GET', `/notes/${noteId}`)).status === 404
  )
  record(
    G,
    'bob deletes alice’s note',
    (await bob.req('DELETE', `/notes/${noteId}`)).status === 404
  )
  const search = await alice.req('GET', '/notes/search?q=.*')
  record(
    G,
    'regex in search does not list everything',
    !/bob-secret/.test(search.text),
    short(search.text)
  )
  const all = await alice.req('GET', '/notes')
  record(
    G,
    'alice’s list excludes bob’s notes',
    !/bob-secret/.test(all.text),
    short(all.text)
  )

  const key = `key-${run}`
  const first = await alice.req('POST', '/notes', {
    json: { title: 'alice-idem', body: 'private' },
    headers: { 'idempotency-key': key },
  })
  const replay = await alice.req('POST', '/notes', {
    json: { title: 'alice-idem', body: 'private' },
    headers: { 'idempotency-key': key },
  })
  record(
    G,
    'idempotent replay works for the same user',
    replay.headers['idempotent-replayed'] === 'true' &&
      replay.json?.id === first.json?.id,
    short(replay.text)
  )
  const crossUser = await bob.req('POST', '/notes', {
    json: { title: 'alice-idem', body: 'private' },
    headers: { 'idempotency-key': key },
  })
  record(
    G,
    'bob cannot replay alice’s idempotency key',
    crossUser.json?.id !== first.json?.id,
    short(crossUser.text)
  )

  const stolen = alice.cookies.get('session')
  const out = await new Browser()
  out.cookies.set('session', stolen)
  record(
    G,
    'control: the session works before logout',
    (await out.req('GET', '/auth/me')).status === 200
  )
  await assertAlive(G)
}

// ─── 6. CSRF (Next.js null-origin bypass) ────────────────────────────────────
{
  const G = 'csrf'
  const note = { json: { title: 'csrf', body: 'x' } }
  const blocked = (res) => res.status === 403
  record(
    G,
    'POST without a token',
    blocked(await alice.req('POST', '/notes', { ...note, noCsrf: true }))
  )
  record(
    G,
    'POST with a wrong token',
    blocked(
      await alice.req('POST', '/notes', {
        ...note,
        headers: { 'x-csrf-token': 'wrong' },
      })
    )
  )
  record(
    G,
    'POST with bob’s token',
    blocked(
      await alice.req('POST', '/notes', {
        ...note,
        headers: { 'x-csrf-token': bob.csrf },
      })
    )
  )
  record(
    G,
    'valid token, Origin: null',
    blocked(
      await alice.req('POST', '/notes', {
        ...note,
        headers: { origin: 'null' },
      })
    )
  )
  record(
    G,
    'valid token, evil Origin',
    blocked(
      await alice.req('POST', '/notes', {
        ...note,
        headers: { origin: 'https://evil.example' },
      })
    )
  )
  record(
    G,
    'valid token, evil Referer',
    blocked(
      await alice.req('POST', '/notes', {
        ...note,
        headers: { referer: 'https://evil.example/x' },
      })
    )
  )
  record(
    G,
    'valid token, look-alike Origin',
    blocked(
      await alice.req('POST', '/notes', {
        ...note,
        headers: { origin: `http://${HOST}:${PORT}.evil.example` },
      })
    )
  )
  record(
    G,
    'method override header',
    blocked(
      await alice.req('POST', '/notes', {
        ...note,
        noCsrf: true,
        headers: { 'x-http-method-override': 'GET' },
      })
    )
  )
  record(
    G,
    'method override query',
    blocked(
      await alice.req('POST', '/notes?_method=GET', { ...note, noCsrf: true })
    )
  )
  const forged = await alice.req('POST', '/notes', {
    ...note,
    noCsrf: true,
    headers: {
      cookie: `${alice.cookieHeader()}; csrf-token=forged.forged`,
      'x-csrf-token': 'forged',
    },
  })
  record(
    G,
    'forged unsigned cookie and header',
    blocked(forged),
    `status ${forged.status}`
  )
  await assertAlive(G)
}

// ─── 7. Static files and downloads ───────────────────────────────────────────
{
  const G = 'files'
  const leak = (res) =>
    res.status === 200 ||
    /STATIC_DOTFILE_LEAKED|"name": ?"0[67]-secure|MONGODB_URI/.test(res.text)
  for (const path of [
    '/.secret',
    '/%2esecret',
    '/./.secret',
    '/x/../.secret',
    '/.SECRET',
    '/.env',
    '/.git/config',
    '/.git/HEAD',
    '/package.json',
    '/exis.config.ts',
    '/src/http/server.ts',
    '/.exis/routes-manifest.js',
    '/..%2fpackage.json',
    '/..%2f..%2fpackage.json',
    '/%2e%2e/package.json',
    '/%2e%2e%2fpackage.json',
    '/..%5cpackage.json',
    '/..%5c..%5cpackage.json',
    '/....//package.json',
    '/..%252fpackage.json',
    '/%c0%ae%c0%ae/package.json',
    '/..\\package.json',
    '/../package.json',
    '/../../package.json',
    '/index.html%00.png',
    '/C:%5cWindows%5cwin.ini',
    '/%5cWindows%5cwin.ini',
  ]) {
    const res = await send('GET', path)
    record(
      G,
      `static ${path}`,
      !leak(res),
      `status ${res.status}: ${short(res.text)}`
    )
  }
  for (const name of [
    '..%2fpackage.json',
    '..%2f..%2fpackage.json',
    '%2e%2e%2fpackage.json',
    '..%5cpackage.json',
    '..%5c..%5cpackage.json',
    '%2fetc%2fpasswd',
    'C:%5cWindows%5cwin.ini',
    '..',
    '.',
    '%00',
    'x%00.txt',
  ]) {
    const res = await alice.req('GET', `/files/${name}`)
    record(
      G,
      `download ${name}`,
      res.status !== 200 && res.status < 500,
      `status ${res.status}: ${short(res.text)}`
    )
  }

  const up = (parts) => {
    const m = multipart(parts)
    return alice.req('POST', '/files', { body: m.body, headers: m.headers })
  }
  const traversal = await up([
    {
      name: 'file',
      filename: '../../evil.txt',
      type: 'text/plain',
      value: 'x',
    },
  ])
  record(
    G,
    'upload name stays inside uploads/',
    traversal.status === 201 && !/[\\/]/.test(traversal.json?.saved ?? ''),
    short(traversal.text)
  )
  record(
    G,
    'upload ../ removed from the reported name',
    !/\.\./.test(traversal.json?.original ?? ''),
    short(traversal.text)
  )
  const win = await up([
    {
      name: 'file',
      filename: '..\\..\\evil.txt',
      type: 'text/plain',
      value: 'x',
    },
  ])
  record(
    G,
    'upload ..\\ removed from the reported name',
    !/\.\./.test(win.json?.original ?? ''),
    short(win.text)
  )
  const typeRes = await up([
    {
      name: 'file',
      filename: 'x.exe',
      type: 'application/x-msdownload',
      value: 'MZ',
    },
  ])
  record(
    G,
    'upload of a refused type',
    typeRes.status >= 400 && typeRes.status < 500,
    `status ${typeRes.status}`
  )
  const big = await up([
    {
      name: 'file',
      filename: 'x.txt',
      type: 'text/plain',
      value: 'a'.repeat(200 * 1024),
    },
  ])
  record(
    G,
    'upload over maxSize',
    big.status === 400 || refusedAsTooLarge(big),
    `status ${big.status} ${big.error ?? ''}`
  )
  const proto = await up([
    { name: '__proto__', value: '{"polluted":1}' },
    { name: 'constructor', value: 'x' },
  ])
  record(
    G,
    'multipart __proto__ field',
    proto.status < 500,
    `status ${proto.status}: ${short(proto.text)}`
  )
  const manyFiles = await up(
    Array.from({ length: 50 }, (_, i) => ({
      name: 'file',
      filename: `f${i}.txt`,
      type: 'text/plain',
      value: 'x',
    }))
  )
  record(
    G,
    'upload of 50 files to a single-file route',
    manyFiles.status >= 400 && manyFiles.status < 500,
    `status ${manyFiles.status}`
  )
  const manyFields = await up(
    Array.from({ length: 150 }, (_, i) => ({ name: `f${i}`, value: 'x' }))
  )
  record(
    G,
    'multipart with 150 fields',
    manyFields.status === 413 || manyFields.status === 400,
    `status ${manyFields.status}`
  )
  const flood = await up(
    Array.from({ length: 20 }, (_, i) => ({
      name: `f${i}`,
      value: 'a'.repeat(500 * 1024),
    }))
  )
  record(
    G,
    'multipart fields total 10 MB against a 1 MB bodyLimit',
    refusedAsTooLarge(flood),
    `status ${flood.status} ${flood.error ?? ''}: ${short(flood.text)}`
  )
  const noBoundary = await alice.req('POST', '/files', {
    body: 'x',
    headers: { 'content-type': 'multipart/form-data' },
  })
  record(
    G,
    'multipart with no boundary',
    noBoundary.status >= 400 && noBoundary.status < 500,
    `status ${noBoundary.status}`
  )
  await assertAlive(G)
}

// ─── 8. Malformed HTTP: smuggling and crashes (Node.js CVE-2026-21710) ───────
{
  const G = 'raw-http'
  const single = (name, payload, extra = () => true) =>
    rawSend(payload).then((res) => {
      record(
        G,
        name,
        !answeredAnotherRequest(res) && res.status !== 200 && extra(res),
        `status ${res.status}, ${res.responses} responses: ${short(res.text)}`
      )
    })
  const h = `Host: ${HOST}:${PORT}\r\n`
  await single(
    'CL + TE smuggling',
    `POST /health HTTP/1.1\r\n${h}Content-Length: 6\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nG`
  )
  await single(
    'two different Content-Lengths',
    `POST /health HTTP/1.1\r\n${h}Content-Length: 1\r\nContent-Length: 2\r\n\r\nGG`
  )
  await single(
    'obfuscated Transfer-Encoding',
    `POST /health HTTP/1.1\r\n${h}Transfer-Encoding: xchunked\r\nContent-Length: 4\r\n\r\n0\r\n\r\n`
  )
  await single(
    'space before colon in TE',
    `POST /health HTTP/1.1\r\n${h}Transfer-Encoding : chunked\r\n\r\n0\r\n\r\n`
  )
  await single(
    'bad chunk size',
    `POST /health HTTP/1.1\r\n${h}Transfer-Encoding: chunked\r\n\r\nZZ\r\nx\r\n0\r\n\r\n`
  )
  await single(
    'negative Content-Length',
    `POST /health HTTP/1.1\r\n${h}Content-Length: -1\r\n\r\n`
  )
  {
    const r = await rawSend(
      `GET /health\r\nSet-Cookie: x=1 HTTP/1.1\r\n${h}\r\n`
    )
    record(
      G,
      'CRLF in the request target injects nothing',
      !/set-cookie: x=1/i.test(r.text),
      short(r.text)
    )
  }
  await single(
    'null byte in a header',
    `GET /auth/me HTTP/1.1\r\n${h}X-Test: a\0b\r\n\r\n`
  )
  await single('no Host header', `GET /auth/me HTTP/1.1\r\n\r\n`)
  await single('invalid HTTP version', `GET /auth/me HTTP/9.9\r\n${h}\r\n`)
  for (const name of [
    '__proto__',
    'constructor',
    'hasOwnProperty',
    'toString',
    'prototype',
  ]) {
    const res = await rawSend(
      `GET /health HTTP/1.1\r\n${h}${name}: x\r\nConnection: close\r\n\r\n`
    )
    const after = await send('GET', '/health')
    record(
      G,
      `header named ${name}`,
      res.status > 0 && res.status < 500 && after.status === 200,
      `status ${res.status}, then ${after.status}`
    )
  }
  const manyHeaders = Array.from({ length: 5000 }, (_, i) => `X-H${i}: 1`).join(
    '\r\n'
  )
  const res = await rawSend(
    `GET /health HTTP/1.1\r\n${h}${manyHeaders}\r\nConnection: close\r\n\r\n`
  )
  record(
    G,
    '5000 headers are refused',
    res.status === 431 || res.status === 400 || res.status === 0,
    `status ${res.status}`
  )
  const crlf = await send('GET', '/hello?name=x%0d%0aSet-Cookie:%20hacked=1')
  record(
    G,
    'CRLF in a query stays out of the headers',
    !crlf.headers['set-cookie']?.some?.((c) => c.startsWith('hacked')),
    `status ${crlf.status}`
  )
  const crlfPath = await send('GET', '/nothing%0d%0aSet-Cookie:%20hacked=1')
  record(
    G,
    'CRLF in a path stays out of the headers',
    !crlfPath.headers['set-cookie']?.some?.((c) => c.startsWith('hacked')),
    `status ${crlfPath.status}`
  )
  for (const path of [
    '/%',
    '/%ff',
    '/%c0%ae',
    '/%00',
    '/a%',
    `/${'a'.repeat(20000)}`,
    `/hello?name=%`,
    `/hello?%=x`,
    '/notes/%ff',
    '/files/%ff',
    '/hello?name=%ff',
  ]) {
    const r = await send('GET', path)
    record(
      G,
      `bad encoding ${path.slice(0, 30)}`,
      r.status < 500,
      `status ${r.status} ${r.error ?? ''}: ${short(r.text)}`
    )
  }
  await assertAlive(G)
}

// ─── 9. Denial of service with small requests ────────────────────────────────
{
  const G = 'dos'
  const timed = async (name, fn, limitMs = 2000) => {
    const start = Date.now()
    const res = await fn()
    const took = Date.now() - start
    record(
      G,
      name,
      took < limitMs && res.status < 500 && res.status !== 0,
      `${took} ms, status ${res.status} ${res.error ?? ''}: ${short(res.text)}`
    )
  }
  const reg = (body) =>
    anon.req('POST', '/auth/register', {
      body,
      headers: { 'content-type': 'application/json' },
    })
  await timed('JSON nested 100,000 deep', () =>
    reg(`${'['.repeat(100000)}${']'.repeat(100000)}`)
  )
  await timed('JSON nested with a prototype key', () =>
    reg(`{"__proto__":1,"a":${'['.repeat(100000)}${']'.repeat(100000)}}`)
  )
  await timed('JSON nested objects with a \\u escape', () =>
    reg(`${'{"\\u0061":'.repeat(50000)}1${'}'.repeat(50000)}`)
  )
  const email = (value) =>
    anon.req('POST', '/auth/register', {
      json: { email: value, name: 'x', password: 'a-long-enough-password' },
    })
  await timed('ReDoS: email with many dots', () =>
    email(`a@${'a.'.repeat(200000)}`)
  )
  await timed('ReDoS: email with many a', () => email(`${'a'.repeat(400000)}@`))
  await timed('ReDoS: email with many @', () => email('@'.repeat(400000)))
  await timed('ReDoS: email with many spaces', () =>
    email(`a${' '.repeat(400000)}@b.c`)
  )
  await timed('50,000 query parameters', () =>
    send(
      'GET',
      `/hello?${Array.from({ length: 5000 }, (_, i) => `p${i}=1`).join('&')}`
    )
  )
  await timed('repeated query key', () =>
    send('GET', `/hello?${'name=a&'.repeat(5000)}`)
  )
  await timed('search with a catastrophic regex', () =>
    alice.req('GET', `/notes/search?q=${encodeURIComponent('(a+)+$')}`)
  )

  const over = await anon.req('POST', '/auth/register', {
    body: JSON.stringify({ a: 'x'.repeat(2 * 1024 * 1024) }),
    headers: { 'content-type': 'application/json' },
  })
  record(
    G,
    'body over bodyLimit is refused',
    refusedAsTooLarge(over),
    `status ${over.status} ${over.error ?? ''}`
  )
  const chunked = await new Promise((resolve) => {
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        method: 'POST',
        path: '/auth/register',
        headers: {
          'content-type': 'application/json',
          cookie: anon.cookieHeader(),
          'x-csrf-token': anon.csrf,
        },
      },
      (r) => {
        r.resume()
        resolve({ status: r.statusCode })
      }
    )
    req.on('error', () => resolve({ status: 0 }))
    for (let i = 0; i < 300; i++) req.write('x'.repeat(10240))
    req.end()
  })
  record(
    G,
    'chunked body over bodyLimit is refused',
    chunked.status === 413 || chunked.status === 0,
    `status ${chunked.status}`
  )
  await assertAlive(G)
}

// ─── 10. What the responses give away ────────────────────────────────────────
{
  const G = 'info-leak'
  const LEAK =
    /node_modules|[\\/]src[\\/]|\.ts:\d|\bat [\w.<>]+ \(|MongoServerError|MongoNetworkError|E11000|ECONNREFUSED|stack"/
  const check = (name, res) =>
    record(
      G,
      name,
      !LEAK.test(res.text),
      `status ${res.status}: ${short(res.text)}`
    )
  check(
    'malformed JSON',
    await anon.req('POST', '/auth/register', {
      body: '{bad',
      headers: { 'content-type': 'application/json' },
    })
  )
  check('404', await send('GET', '/does-not-exist'))
  check('405', await send('DELETE', '/health'))
  check('wrong id type', await alice.req('GET', '/notes/nope'))
  check(
    'duplicate key',
    await anon.req('POST', '/auth/register', {
      json: {
        email: `alice-${run}@example.com`,
        name: 'x',
        password: 'a-long-enough-password',
      },
    })
  )
  check(
    'bad multipart',
    await alice.req('POST', '/files', {
      body: 'garbage',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
    })
  )
  check(
    'HTML accept on an error',
    await send('GET', '/does-not-exist', { headers: { accept: 'text/html' } })
  )

  const badPw = await anon.req('POST', '/auth/register', {
    json: {
      email: 'not-an-email',
      name: 'x',
      password: 'hunter2-is-my-secret',
    },
  })
  record(
    G,
    'validation errors do not echo a password',
    !/hunter2/.test(badPw.text),
    short(badPw.text)
  )

  for (const path of [
    '/docs',
    '/docs/json',
    '/swagger',
    '/openapi.json',
    '/metrics',
    '/debug',
    '/_debug',
    '/routes',
    '/.exis',
    '/env',
    '/config',
  ]) {
    const res = await send('GET', path)
    record(
      G,
      `no open ${path}`,
      res.status !== 200,
      `status ${res.status}: ${short(res.text)}`
    )
  }
  const liveness = await send('GET', '/_ready')
  record(
    G,
    '/_ready names no internals',
    !/mongodb:\/\/|localhost:27017|password|version/i.test(liveness.text),
    short(liveness.text)
  )
  await assertAlive(G)
}

// ─── 11. Response headers, XSS, CORS, Host ───────────────────────────────────
{
  const G = 'headers'
  const res = await send('GET', '/health')
  for (const [name, test] of Object.entries({
    'content-security-policy': (v) => Boolean(v),
    'x-content-type-options': (v) => v === 'nosniff',
    'x-frame-options': (v) => Boolean(v),
    'referrer-policy': (v) => Boolean(v),
    'strict-transport-security': (v) => Boolean(v),
  })) {
    record(
      G,
      `header ${name}`,
      test(res.headers[name]),
      `value ${res.headers[name]}`
    )
  }
  record(
    G,
    'no X-Powered-By',
    !res.headers['x-powered-by'],
    res.headers['x-powered-by']
  )
  record(
    G,
    'Server names no version',
    !/\d/.test(res.headers.server ?? ''),
    res.headers.server
  )

  const xss = await send(
    'GET',
    `/hello?name=${encodeURIComponent('<script>alert(1)</script>')}`
  )
  record(
    G,
    'reflected string is not HTML',
    !/html/i.test(xss.headers['content-type'] ?? ''),
    `content-type ${xss.headers['content-type']}`
  )
  record(
    G,
    'reflected string has nosniff',
    xss.headers['x-content-type-options'] === 'nosniff',
    xss.headers['x-content-type-options']
  )
  const xss404 = await send(
    'GET',
    `/${encodeURIComponent('<script>alert(1)</script>')}`,
    { headers: { accept: 'text/html' } }
  )
  record(
    G,
    '404 with script is not HTML',
    !/html/i.test(xss404.headers['content-type'] ?? '') ||
      !/<script>/.test(xss404.text),
    `content-type ${xss404.headers['content-type']}`
  )
  const xssErr = await send(
    'DELETE',
    `/health?x=${encodeURIComponent('<script>')}`,
    { headers: { accept: 'text/html' } }
  )
  record(
    G,
    '405 is not HTML',
    !/html/i.test(xssErr.headers['content-type'] ?? ''),
    `content-type ${xssErr.headers['content-type']}`
  )

  const cors = await alice.req('GET', '/auth/me', {
    headers: { origin: 'https://evil.example' },
  })
  record(
    G,
    'CORS does not allow an evil origin with credentials',
    !(
      cors.headers['access-control-allow-credentials'] === 'true' &&
      /evil|\*/.test(cors.headers['access-control-allow-origin'] ?? '')
    ),
    JSON.stringify(cors.headers['access-control-allow-origin'])
  )

  for (const [name, headers] of Object.entries({
    'evil Host': { host: 'evil.example' },
    'evil X-Forwarded-Host': { 'x-forwarded-host': 'evil.example' },
    'evil X-Forwarded-Proto': { 'x-forwarded-proto': 'javascript' },
    'evil CF-Visitor': { 'cf-visitor': '{"scheme":"javascript"}' },
  })) {
    for (const path of ['/health', '/does-not-exist', '/_ready']) {
      const r = await send('GET', path, { headers })
      record(
        G,
        `${name} on ${path} is not reflected`,
        !/evil\.example|javascript/.test(r.text + JSON.stringify(r.headers)),
        short(r.text)
      )
    }
  }

  const cookieLine = firstSessionCookie
  record(
    G,
    'session cookie is HttpOnly',
    /httponly/i.test(cookieLine),
    cookieLine
  )
  record(
    G,
    'session cookie has SameSite',
    /samesite=/i.test(cookieLine),
    cookieLine
  )
  await assertAlive(G)
}

// ─── 12. Sessions and login limits ───────────────────────────────────────────
{
  const G = 'session'
  const token = alice.cookies.get('session')
  const before = await alice.req('GET', '/auth/me')
  record(
    G,
    'session works before logout',
    before.status === 200,
    `status ${before.status}`
  )
  const out = await alice.req('POST', '/auth/logout')
  record(G, 'logout succeeds', out.status === 200, `status ${out.status}`)
  const replay = await send('GET', '/auth/me', {
    headers: { cookie: `session=${token}` },
  })
  record(
    G,
    'a stolen token dies at logout',
    replay.status === 401,
    `status ${replay.status}`
  )

  // Last: this locks login for the rest of the window
  let limited = false
  for (let i = 0; i < 30 && !limited; i++) {
    const r = await anon.req('POST', '/auth/login', {
      json: { email: 'brute@example.com', password: `guess-${i}` },
    })
    limited = r.status === 429
  }
  record(G, 'login brute force hits the rate limit', limited)
  if (limited) {
    const guess = { json: { email: 'brute@example.com', password: 'guess' } }
    for (const [name, opts, path] of [
      [
        'X-Forwarded-For',
        { headers: { 'x-forwarded-for': '9.9.9.9' } },
        '/auth/login',
      ],
      ['X-Real-IP', { headers: { 'x-real-ip': '9.9.9.9' } }, '/auth/login'],
      [
        'CF-Connecting-IP',
        { headers: { 'cf-connecting-ip': '9.9.9.9' } },
        '/auth/login',
      ],
      [
        'True-Client-IP',
        { headers: { 'true-client-ip': '9.9.9.9' } },
        '/auth/login',
      ],
      ['trailing slash', {}, '/auth/login/'],
      ['double slash', {}, '//auth/login'],
      ['query string', {}, '/auth/login?x=1'],
    ]) {
      const r = await anon.req('POST', path, { ...guess, ...opts })
      record(
        G,
        `rate limit not bypassed by ${name}`,
        r.status === 429,
        `status ${r.status}: ${short(r.text)}`
      )
    }
  }
  await assertAlive(G)
}

// ─── Report ──────────────────────────────────────────────────────────────────
const holes = results.filter((r) => !r.ok)
const byGroup = new Map()
for (const r of results) {
  const g = byGroup.get(r.group) ?? { total: 0, holes: 0 }
  g.total++
  if (!r.ok) g.holes++
  byGroup.set(r.group, g)
}
console.log('\nGroup                  Checks  Holes')
for (const [name, g] of byGroup) {
  console.log(
    `${name.padEnd(22)} ${String(g.total).padStart(6)} ${String(g.holes).padStart(6)}`
  )
}
console.log(
  `\n${results.length} checks, ${holes.length} holes against ${base.origin}`
)
process.exit(holes.length > 0 ? 1 : 0)
