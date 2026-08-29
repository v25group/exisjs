import { exis } from '../../packages/exisjs/src'

async function runNodeServer() {
  const appDef = exis({
    server: 'node',
    logger: false,
    async onStart(app) {
      app.get('/', (_req: any, res: any) => {
        res.json({ status: 'ok', server: 'node' })
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

  console.log('Node Profiling Server listening on port 3000')
}

runNodeServer().catch((err) => {
  console.error(err)
  process.exit(1)
})
