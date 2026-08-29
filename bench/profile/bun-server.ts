import { exis } from '../../packages/exisjs/src'

async function runBunServer() {
  const appDef = exis({
    server: 'bun',
    logger: false,
    async onStart(app) {
      app.get('/', (_req: any, res: any) => {
        res.json({ status: 'ok', server: 'bun' })
      })
      app.get('/memory', (_req: any, res: any) => {
        // Bun has its own memoryUsage, but process.memoryUsage() often polyfilled
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

  console.log('Bun Profiling Server listening on port 3000')
}

runBunServer().catch((err) => {
  console.error(err)
  process.exit(1)
})
