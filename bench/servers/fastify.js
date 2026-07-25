const fastify = require('fastify')({ logger: false })

fastify.get('/api/health', async (request, reply) => {
  return { status: 'ok', message: 'Hello from Fastify!' }
})

const port = process.env.PORT || 3002
fastify.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) throw err
  console.log(`Fastify listening on ${port}`)
})
