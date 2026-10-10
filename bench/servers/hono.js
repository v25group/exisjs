// Hono on @hono/node-server. Hono has no built-in validator, so POST /users
// uses the same hand-written check as the raw baseline.
const { serve } = require('@hono/node-server')
const { Hono } = require('hono')
const { PORT, HELLO, validateUserManually, attachIpc } = require('./_shared')

const app = new Hono()
app.get('/json', (c) => c.json(HELLO))
app.get('/users/:id', (c) =>
  c.json({ id: c.req.param('id'), fields: c.req.query('fields') ?? null })
)
app.post('/echo', async (c) => c.json(await c.req.json()))
app.post('/users', async (c) => {
  const body = await c.req.json()
  return validateUserManually(body)
    ? c.json(body, 201)
    : c.json({ error: 'invalid' }, 400)
})

serve({ fetch: app.fetch, port: PORT }, () => attachIpc('hono'))
