// Fastify, idiomatic: JSON-schema validation compiled by Ajv
const fastify = require('fastify')({ logger: false })
const { PORT, HELLO, USER_RULES, attachIpc } = require('./_shared')

fastify.get('/json', async () => HELLO)
fastify.get('/users/:id', async (req) => ({
  id: req.params.id,
  fields: req.query.fields ?? null,
}))
fastify.post('/echo', async (req) => req.body)
fastify.post(
  '/users',
  {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'email', 'age'],
        properties: USER_RULES,
      },
    },
  },
  async (req, reply) => {
    reply.code(201)
    return req.body
  }
)

fastify.listen({ port: PORT, host: '0.0.0.0' }).then(() => attachIpc('fastify'))
