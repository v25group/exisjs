import { exis } from '../packages/exisjs/src'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

async function runBenchmark() {
  const appDef = exis({
    logger: false, // disable logging for benchmark
    compression: true,
    keepAlive: {
      timeoutMs: 5000,
      headersTimeoutMs: 60000,
    },
    async onStart(app) {
      app.get('/', (_req: any, res: any) => {
        res.json({ status: 'ok', message: 'Hello World!' })
      })
    }
  })

  const app = await appDef.boot()

  await new Promise<void>((resolve) => {
    app.listen({ port: 4000, onListen: () => resolve() })
  })

  console.log('Server started on port 4000')
  console.log(`Backend in use: ${app.options.server}`)
  console.log('Running autocannon benchmark via npx...')

  try {
    const { stdout } = await execAsync('npx autocannon --json -c 100 -p 10 -d 10 http://localhost:4000/')
    const result = JSON.parse(stdout)

    // Gracefully close server before printing results
    await app.close()

    console.log('\n--- Benchmark Results ---')
    console.log(`Requests/sec: ${result.requests.average}`)
    console.log(`Latency (ms): ${result.latency.average}`)
    console.log(
      `Throughput (MB/s): ${(result.throughput.average / 1024 / 1024).toFixed(2)}`
    )

    // Check baseline performance
    const minRps = 5000
    if (result.requests.average < minRps) {
      console.error(
        `\n❌ Benchmark failed! Expected at least ${minRps} req/sec, but got ${result.requests.average}`
      )
      process.exitCode = 1
    } else {
      console.log(
        `\n✅ Benchmark passed! Exceeded baseline of ${minRps} req/sec.`
      )
      process.exitCode = 0
    }
  } catch (e: any) {
    console.error('Benchmark failed to execute:', e.message)
    await app.close()
    process.exitCode = 1
  }
}

runBenchmark().catch((err) => {
  console.error(err)
  process.exit(1)
})
