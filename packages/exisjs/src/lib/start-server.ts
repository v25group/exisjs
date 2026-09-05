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
    const { loadEnv } = await import('../config/env.js')
    loadEnv(cwd)

    // 2. Auto-load Environment variables validation file if it exists
    const envFiles = [
      path.join(cwd, 'src', 'config', 'env.ts'),
      path.join(cwd, 'src', 'config', 'env.js'),
    ]

    for (const envFile of envFiles) {
      if (fs.existsSync(envFile)) {
        await dynamicImport(pathToFileURL(envFile).href)
        break // Load only the first one found
      }
    }

    const url = pathToFileURL(entryFile).href
    const mod = await dynamicImport(url)

    // Support declarative `export default exis({ ... })` or `@Server` classes
    let app = mod.default || mod.app
    let instance: import('../server/app.js').App | null = null
    const { setActiveAppInstance } = await import('../server/app.js')

    if (app && app._isExisAppDefinition) {
      // It's a functional ExisAppDefinition from exis({})
      const AppClass = (await import('../server/app.js')).App
      instance = new AppClass(app.options)
      if (app.options.onStart) {
        instance.onStartHook = app.options.onStart
      }
      if (app.options.onClose) {
        instance.onCloseHook = app.options.onClose
      }
      app = instance
      setActiveAppInstance(instance)
    }
    // Check if it's a class decorated with @Server
    else if (
      app &&
      typeof app === 'function' &&
      app.prototype &&
      app.prototype[Symbol.for('exisjs:server_config')]
    ) {
      const serverConfig = app.prototype[Symbol.for('exisjs:server_config')]
      const AppClass = (await import('../server/app.js')).App
      instance = new AppClass({
        plugins: serverConfig.plugins,
      })

      const serverInstance = new app()
      if (serverConfig.providers) {
        for (const p of serverConfig.providers) {
          instance.provide(p[0], p[1])
        }
      }

      instance.onStartHook = async () => {
        if (typeof serverInstance.onStart === 'function') {
          await serverInstance.onStart(instance)
        }
      }

      instance.onCloseHook = async () => {
        if (typeof serverInstance.onClose === 'function') {
          await serverInstance.onClose(instance!)
        }
      }

      app = instance
      setActiveAppInstance(instance)
    }

    if (
      app &&
      typeof app.create === 'function' &&
      typeof app.listen === 'function'
    ) {
      await app.create()

      // ─── Boot Telemetry (if configured) ───────────────────────────────────────
      if (
        app &&
        app.options &&
        app.options.telemetry &&
        app.options.telemetry.enabled
      ) {
        try {
          const telemetry = await import('@exisjs/telemetry')
          telemetry.initTelemetry(app.options.telemetry)
        } catch (err: any) {
          if (err.code === 'ERR_MODULE_NOT_FOUND') {
            console.warn(
              '\x1b[33m[ExisJS] Warning: config.telemetry is enabled, but @exisjs/telemetry is not installed. Please run `npm install @exisjs/telemetry`.\x1b[0m'
            )
          } else {
            console.error('[ExisJS] Failed to initialize telemetry:', err)
          }
        }
      }

      if (typeof app.onStartHook === 'function') {
        await app.onStartHook(app)
      }
      await app.listen()

      // ─── Graceful Shutdown ───────────────────────────────────────────────────
      // On SIGTERM (Kubernetes, Docker stop) or SIGINT (Ctrl+C), close the
      // server cleanly rather than hard-killing it — this allows in-flight
      // requests to complete and prevents data loss.
      const shutdown = async (signal: string) => {
        const isCLI = process.env.__EXIS_DEV_SERVER || process.env.__EXIS_CLI
        if (!isCLI) {
          console.error(
            `\n[exis] ${signal} received. Shutting down gracefully...`
          )
        }
        try {
          if (typeof app.close === 'function') {
            await app.close()
          }
          if (!isCLI) console.error('[exis] Server closed cleanly.')
          process.exit(0)
        } catch (err) {
          if (!isCLI) console.error('[exis] Error during shutdown:', err)
          process.exit(1)
        }
      }

      process.once('SIGTERM', () => shutdown('SIGTERM'))
      process.once('SIGINT', () => shutdown('SIGINT'))
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
async function bootstrap() {
  let workers: number | 'safe' | 'max' = 1
  try {
    const { loadEnv } = await import('../config/env.js')
    loadEnv(process.cwd())

    const { loadConfig } = await import('../config/config.js')
    const config = await loadConfig(process.cwd())
    if (config.cluster && config.cluster.workers) {
      workers =
        config.cluster.workers === 'auto' ? 'max' : config.cluster.workers
    } else if (config.workers) {
      // Fallback for legacy workers config
      workers = config.workers
    }
  } catch {
    // Ignore config load error for primary process. The worker process will
    // throw it properly with full trace if it actually fails.
  }

  runInCluster(
    () => {
      start()
    },
    { workers }
  )
}

bootstrap()
