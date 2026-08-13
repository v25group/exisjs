const { exis } = require('exisjs')

const appDef = exis({
  port: process.env.PORT || 3004,
  logger: false, // Fully disable logger to match bare fastify
  helmet: false, // Fastify/Hono don't run helmet by default
  cors: false, // Fastify/Hono don't run cors by default
  server: 'node',
  async onStart(app) {
    app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', message: 'Hello from Exis!' })
    })

    app.get('/api/kill', (req, res) => {
      res.send('shutting down')
      setTimeout(() => process.exit(0), 100)
    })
  }
})

appDef.boot().then((app) => {
  app.listen({
    port: Number(process.env.PORT) || 3004,
    onListen: () => {
      console.log(
        `Exis listening on ${process.env.PORT || 3004} using ${app.explicitOptions.server || 'node'}`
      )
    },
  })
})
