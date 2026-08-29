import { exis } from '../../packages/exisjs/src'

async function runUwsServer() {
  const appDef = exis({
    server: 'uws',
    logger: false,
    async onStart(app) {
      app.get('/', (_req: any, res: any) => {
        res.json({ status: 'ok', server: 'uws' })
      })
      app.get('/memory', (_req: any, res: any) => {
        res.json(process.memoryUsage())
      })
      app.post('/echo', (req: any, res: any) => {
        res.json(req.body || {})
      })
    }
  })

  const app = await appDef.boot()

  await new Promise<void>((resolve) => {
    app.listen({ port: 3000, onListen: () => resolve() })
  })

  console.log('uWS Profiling Server listening on port 3000')
}

runUwsServer().catch((err) => {
  console.error(err)
  process.exit(1)
})
