// Framework cost per request without the network: drives each server's
// request handler with in-memory sockets, so kernel I/O and the load
// generator drop out. Compares ExisJS (functional and class controllers)
// against a plain node:http handler doing the same work.
//
//   node bench/micro/pipeline.js [requests=100000] [scenario...]
//
// Prints µs per request (median of 5 interleaved rounds); differences of
// ~0.2 µs are noise.
const http = require('node:http')
const { Duplex } = require('node:stream')
// EXIS_DIST=<path to a dist folder> compares another build (e.g. a baseline)
const lib = process.env.EXIS_DIST || 'exisjs'
const { exis } = require(lib)
const { tex } = require(`${lib}/validator`)
const { Controller, Get, Post, Param, Query, Body, HttpCode } = require(
  `${lib}/decorators`
)
const { HELLO, validateUserManually } = require('../servers/_shared')

const N = Number(process.argv[2]) || 100_000
const only = process.argv.slice(3)

// A socket that accepts and discards everything
class NullSocket extends Duplex {
  constructor(record) {
    super()
    this.remoteAddress = '127.0.0.1'
    this.encrypted = false
    this.written = record ? [] : null
  }
  _read() {
    // the request body is pushed by request()
  }
  _write(chunk, _enc, cb) {
    if (this.written) this.written.push(Buffer.from(chunk))
    cb()
  }
  _writev(chunks, cb) {
    if (this.written)
      for (const c of chunks) this.written.push(Buffer.from(c.chunk))
    cb()
  }
  setTimeout() {
    return this
  }
  setNoDelay() {
    return this
  }
  setKeepAlive() {
    return this
  }
}

const USER = JSON.stringify({
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  age: 36,
})
const ECHO = JSON.stringify({
  id: 1,
  tags: ['a', 'b'],
  nested: { ok: true, n: 42 },
})
const SCENARIOS = {
  json: { method: 'GET', url: '/json' },
  params: { method: 'GET', url: '/users/12345?fields=name' },
  echo: { method: 'POST', url: '/echo', body: ECHO },
  validate: { method: 'POST', url: '/users', body: USER },
  miss: { method: 'GET', url: '/nothing/here' },
}

function request(handler, { method, url, body }, record = false) {
  return new Promise((resolve) => {
    const socket = new NullSocket(record)
    const req = new http.IncomingMessage(socket)
    req.method = method
    req.url = url
    req.httpVersion = '1.1'
    req.httpVersionMajor = 1
    req.httpVersionMinor = 1
    req.headers = { host: 'localhost' }
    if (body !== undefined) {
      req.headers['content-type'] = 'application/json'
      req.headers['content-length'] = String(Buffer.byteLength(body))
    }
    const res = new http.ServerResponse(req)
    res.assignSocket(socket)
    res.on('finish', () =>
      resolve(socket.written && Buffer.concat(socket.written).toString())
    )
    handler(req, res)
    if (body !== undefined) req.push(body)
    req.push(null)
    req.complete = true
  })
}

// ─── Targets ───────────────────────────────────────────────────────────────
function rawNode() {
  const send = (res, status, data) => {
    const payload = JSON.stringify(data)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
    })
    res.end(payload)
  }
  const readJson = (req, cb) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        cb(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        cb(undefined)
      }
    })
  }
  return (req, res) => {
    const q = req.url.indexOf('?')
    const path = q === -1 ? req.url : req.url.slice(0, q)
    if (req.method === 'GET' && path === '/json') return send(res, 200, HELLO)
    if (req.method === 'GET' && path.startsWith('/users/')) {
      const params = new URLSearchParams(q === -1 ? '' : req.url.slice(q + 1))
      return send(res, 200, { id: path.slice(7), fields: params.get('fields') })
    }
    if (req.method === 'POST' && path === '/echo')
      return readJson(req, (b) => send(res, 200, b))
    if (req.method === 'POST' && path === '/users') {
      return readJson(req, (b) =>
        validateUserManually(b)
          ? send(res, 201, b)
          : send(res, 400, { error: 'invalid' })
      )
    }
    send(res, 404, { error: 'not found' })
  }
}

const User = tex.object({
  name: tex.string({ min: 2, max: 64 }),
  email: tex.email(),
  age: tex.number({ min: 0, max: 150 }),
})
const settings = {
  env: 'production',
  logger: false,
  helmet: false,
  cors: false,
}

async function exisFunctional() {
  const app = await exis({
    ...settings,
    async onStart(app) {
      app.get('/json', (_req, res) => res.json(HELLO))
      app.get('/users/:id', (req, res) =>
        res.json({ id: req.params.id, fields: req.query.fields ?? null })
      )
      app.post('/echo', async (req, res) => res.json(await req.json()))
      app.post('/users', { body: User }, (req, res) =>
        res.status(201).json(req.body)
      )
    },
  }).boot()
  return (req, res) => app.handle(req, res)
}

// File-route style: controller({ ... }) objects, as route.ts files export
async function exisController() {
  const { controller, route } = require(`${lib}/router`)
  const app = await exis({
    ...settings,
    async onStart(app) {
      app.registerFunctionalController(
        controller({
          json: route.get('/json', { handle: () => HELLO }),
          user: route.get('/users/:id', {
            handle: ({ params, query }) => ({
              id: params.id,
              fields: query.fields ?? null,
            }),
          }),
          echo: route.post('/echo', { handle: ({ body }) => body }),
          create: route.post('/users', {
            body: User,
            httpCode: 201,
            handle: ({ body }) => body,
          }),
        })
      )
    },
  }).boot()
  return (req, res) => app.handle(req, res)
}

// Default configuration (helmet, CORS, request id...), logger off
async function exisDefaults() {
  const app = await exis({
    env: 'production',
    logger: false,
    async onStart(app) {
      app.get('/json', (_req, res) => res.json(HELLO))
      app.get('/users/:id', (req, res) =>
        res.json({ id: req.params.id, fields: req.query.fields ?? null })
      )
      app.post('/echo', async (req, res) => res.json(await req.json()))
      app.post('/users', { body: User }, (req, res) =>
        res.status(201).json(req.body)
      )
    },
  }).boot()
  return (req, res) => app.handle(req, res)
}

async function exisClass() {
  class BenchController {
    json() {
      return HELLO
    }
    user(id, fields) {
      return { id, fields: fields ?? null }
    }
    echo(body) {
      return body
    }
    create(body) {
      return body
    }
  }
  const proto = BenchController.prototype
  const method = (decorators, name, params = []) => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name)
    params.forEach((decorate, index) => decorate(proto, name, index))
    for (const decorate of decorators) decorate(proto, name, descriptor)
  }
  method([Get('/json')], 'json')
  method([Get('/users/:id')], 'user', [Param('id'), Query('fields')])
  method([Post('/echo')], 'echo', [Body()])
  method([Post('/users', { body: User }), HttpCode(201)], 'create', [Body()])
  Controller('/')(BenchController)
  const app = await exis({
    ...settings,
    async onStart(app) {
      app.registerControllers([BenchController])
    },
  }).boot()
  return (req, res) => app.handle(req, res)
}

async function measure(handler, scenario, n) {
  for (let i = 0; i < 5000; i++) await request(handler, scenario) // warmup
  // Wall time: the loop is single-threaded and never idle, and Windows'
  // process.cpuUsage() only ticks every 15.6 ms
  const start = process.hrtime.bigint()
  for (let i = 0; i < n; i++) await request(handler, scenario)
  return Number(process.hrtime.bigint() - start) / 1000 / n
}

;(async () => {
  const targets = {
    'node:http': rawNode(),
    'exis-fn': await exisFunctional(),
    'exis-class': await exisClass(),
    'exis-ctrl': await exisController(),
    'exis-dflt': await exisDefaults(),
  }
  // Correctness first: every target must answer like node:http
  for (const [id, scenario] of Object.entries(SCENARIOS)) {
    const answer = async (handler) => {
      const text = await request(handler, scenario, true)
      const [head, body] = text.split('\r\n\r\n')
      return { status: head.split(' ')[1], body: id === 'miss' ? '' : body }
    }
    const expected = await answer(targets['node:http'])
    for (const [name, handler] of Object.entries(targets)) {
      const got = await answer(handler)
      if (got.status !== expected.status || got.body !== expected.body) {
        throw new Error(
          `${name} ${id}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`
        )
      }
    }
  }

  const names = Object.keys(targets).filter(
    (n) => !process.env.TARGET || n === process.env.TARGET
  )
  const scenarios = only.length ? only : Object.keys(SCENARIOS)
  console.log(`${N} requests per cell, µs/request (median of 5 interleaved)`)
  console.log(['scenario', ...names].map((s) => s.padStart(11)).join(''))
  for (const s of scenarios) {
    const runs = Object.fromEntries(names.map((n) => [n, []]))
    for (let round = 0; round < 5; round++) {
      for (const n of names)
        runs[n].push(await measure(targets[n], SCENARIOS[s], N))
    }
    const median = (a) => a.sort((x, y) => x - y)[2]
    console.log(
      [s, ...names.map((n) => median(runs[n]).toFixed(2))]
        .map((v) => String(v).padStart(11))
        .join('')
    )
  }
  process.exit(0)
})()
