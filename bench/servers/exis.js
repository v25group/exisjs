// ExisJS, idiomatic: tex validation, helmet/cors off to match the bare
// frameworks. BACKEND=node|uws selects the HTTP engine.
const { exis } = require('exisjs')
const { tex } = require('exisjs/validator')
const { PORT, HELLO, attachIpc } = require('./_shared')

const backend = process.env.BACKEND || 'node'

const User = tex.object({
  name: tex.string({ min: 2, max: 64 }),
  email: tex.email(),
  age: tex.number({ min: 0, max: 150 }),
})

exis({
  port: PORT,
  server: backend,
  env: 'production',
  logger: false,
  helmet: false,
  cors: false,
  async onStart(app) {
    app.get('/json', (_req, res) => {
      res.json(HELLO)
    })
    app.get('/users/:id', (req, res) => {
      res.json({ id: req.params.id, fields: req.query.fields ?? null })
    })
    app.post('/echo', async (req, res) => {
      res.json(await req.json())
    })
    app.post('/users', { body: User }, (req, res) => {
      res.status(201).json(req.body)
    })
  },
})
  .boot()
  .then((app) =>
    app.listen({ port: PORT, onListen: () => attachIpc(`exis-${backend}`) })
  )
