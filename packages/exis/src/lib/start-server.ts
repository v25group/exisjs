import v8 from 'node:v8'
import { pathToFileURL } from 'node:url'
import { runInCluster } from '../server/cluster.js'

async function start() {
  // ─── Memory threshold monitor (only runs on worker processes) ───────────
  setInterval(() => {
    const stats = v8.getHeapStatistics()
    if (stats.used_heap_size > 0.8 * stats.heap_size_limit) {
      console.error(
        '\x1b[33m[exis]\x1b[0m Server is approaching memory threshold, restarting...'
      )
      process.exit(143) // exit with SIGTERM equivalent
    }
  }, 10000).unref() // don't block the event loop

  const entryFile = process.env.EXIS_ENTRY_FILE

  if (!entryFile) {
    console.error('EXIS_ENTRY_FILE environment variable is missing.')
    process.exit(1)
  }

  try {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const cwd = process.cwd()

    const dynamicImport = new Function('specifier', 'return import(specifier)')

    // 1. Load .env files so process.env is populated
    const { loadEnv } = await import('../utils/env.js')
    loadEnv(cwd)

    // 2. Auto-load Environment variables validation file if it exists
    const envFiles = [
      path.join(cwd, 'src', 'env.ts'),
      path.join(cwd, 'src', 'env.js'),
      path.join(cwd, 'env.ts'),
      path.join(cwd, 'env.js'),
    ]

    for (const envFile of envFiles) {
      if (fs.existsSync(envFile)) {
        await dynamicImport(pathToFileURL(envFile).href)
        break // Load only the first one found
      }
    }

    const url = pathToFileURL(entryFile).href
    const mod = await dynamicImport(url)

    // Support declarative `export default exis({ ... })`
    const app = mod.default || mod.app
    if (
      app &&
      typeof app.create === 'function' &&
      typeof app.listen === 'function'
    ) {
      await app.create()
      if (typeof app.onStartHook === 'function') {
        await app.onStartHook(app)
      }
      await app.listen()
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

// ─── Multi-core cluster mode ────────────────────────────────────────────────────
// The primary process forks workers across all CPU cores.
// Each worker independently runs start() to boot its own HTTP server instance.
// If a worker crashes, the cluster manager automatically respawns it.
runInCluster(() => {
  start()
})
