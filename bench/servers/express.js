// Express 5 with express.json(). No built-in validator, so POST /users uses
// the same hand-written check as the raw baseline.
const express = require('express')
const { PORT, HELLO, validateUserManually, attachIpc } = require('./_shared')

const app = express()
app.disable('x-powered-by')
app.disable('etag')
app.use(express.json())

app.get('/json', (_req, res) => res.json(HELLO))
app.get('/users/:id', (req, res) =>
  res.json({ id: req.params.id, fields: req.query.fields ?? null })
)
app.post('/echo', (req, res) => res.json(req.body))
app.post('/users', (req, res) =>
  validateUserManually(req.body)
    ? res.status(201).json(req.body)
    : res.status(400).json({ error: 'invalid' })
)

app.listen(PORT, () => attachIpc('express'))
