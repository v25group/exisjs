const { serve } = require('@hono/node-server')
const { Hono } = require('hono')

const app = new Hono()

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', message: 'Hello from Hono!' })
})

const port = process.env.PORT || 3003
serve({ fetch: app.fetch, port }, () => {
  console.log(`Hono listening on ${port}`)
})
