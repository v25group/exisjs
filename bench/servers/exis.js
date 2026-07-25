const { exis } = require('exisjs')

const app = exis({
  port: process.env.PORT || 3004,
  logger: false, // Fully disable logger to match bare fastify
  helmet: false, // Fastify/Hono don't run helmet by default
  cors: false, // Fastify/Hono don't run cors by default
  server: 'auto',
})

app.get(
  '/api/health',
  {
    response: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        message: { type: 'string' },
      },
    },
  },
  (req, res) => {
    res.json({ status: 'ok', message: 'Hello from Exis!' })
  }
)

app.listen({
  port: Number(process.env.PORT) || 3004,
  onListen: () => {
    console.log(
      `Exis listening on ${process.env.PORT || 3004} using auto`
    )
  }
})
