import { performance } from 'node:perf_hooks'
import app from './src/http/server'
import { createTestApp } from 'exisjs/testing'

async function run() {
  console.log('--- Testing Zero-TCP app.inject() Benchmark ---')

  const testApp = createTestApp(app)

  // Warmup the routing tree
  try {
    await testApp.get('/').execute()
  } catch (e) {}

  const start = performance.now()

  let successCount = 0
  for (let i = 0; i < 10000; i++) {
    const res = await testApp.get('/').execute()
    if (res.status === 200) successCount++
  }

  const end = performance.now()
  console.log(`Executed 10,000 requests in ${(end - start).toFixed(2)}ms`)
  console.log(`Success Count: ${successCount}`)
}

run().catch(console.error)
