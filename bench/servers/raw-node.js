// Baseline: plain node:http with hand-rolled routing. The ceiling every
// framework on Node's HTTP stack is measured against.
const http = require('node:http')
const { PORT, HELLO, validateUserManually, attachIpc } = require('./_shared')

function send(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readJson(req, cb) {
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

http
  .createServer((req, res) => {
    const q = req.url.indexOf('?')
    const path = q === -1 ? req.url : req.url.slice(0, q)
    if (req.method === 'GET' && path === '/json') return send(res, 200, HELLO)
    if (req.method === 'GET' && path.startsWith('/users/')) {
      const params = new URLSearchParams(q === -1 ? '' : req.url.slice(q + 1))
      return send(res, 200, {
        id: path.slice(7),
        fields: params.get('fields'),
      })
    }
    if (req.method === 'POST' && path === '/echo') {
      return readJson(req, (body) => send(res, 200, body))
    }
    if (req.method === 'POST' && path === '/users') {
      return readJson(req, (body) =>
        validateUserManually(body)
          ? send(res, 201, body)
          : send(res, 400, { error: 'invalid' })
      )
    }
    send(res, 404, { error: 'not found' })
  })
  .listen(PORT, () => attachIpc('node:http'))
