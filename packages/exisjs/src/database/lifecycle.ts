export type DatabaseHealthStatus =
  'connected' | 'connecting' | 'disconnected' | 'error'

export interface DatabaseHealthInfo {
  name: string
  status: DatabaseHealthStatus
  latencyMs?: number
  error?: string
  details?: Record<string, any>
}

export interface DatabaseRegistration {
  name: string
  connect: () => Promise<void> | void
  disconnect: () => Promise<void> | void
  isHealthy?: () =>
    Promise<boolean | DatabaseHealthInfo> | boolean | DatabaseHealthInfo
  healthCheck?: () =>
    Promise<boolean | DatabaseHealthInfo> | boolean | DatabaseHealthInfo
  /**
   * How long a health check may take before it counts as failed, so one
   * unresponsive database cannot hang `/_ready`. Default: 5000 ms.
   */
  healthTimeoutMs?: number
}

const DEFAULT_HEALTH_TIMEOUT_MS = 5000

/** Rejects when `promise` has not settled after `ms`. */
export function withTimeout<T>(
  promise: Promise<T> | T,
  ms: number,
  message: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
    timer.unref?.()
  })
  return Promise.race([Promise.resolve(promise), timeout]).finally(() =>
    clearTimeout(timer)
  )
}

/**
 * Universal Database Manager for ExisJS.
 * Manages connections, graceful shutdown, and health checks for any database
 * (Mongoose, Prisma, Drizzle, PostgreSQL, MySQL, SQLite, Redis).
 */
export class DatabaseManager {
  private static databases = new Map<
    string,
    DatabaseRegistration & {
      _connected?: boolean
      _disconnecting?: Promise<void>
    }
  >()
  private static isShutdownHookRegistered = false
  private static appManagedShutdown = false
  // Probes that arrive while a check is running share its result
  private static healthInFlight?: Promise<{
    healthy: boolean
    databases: Record<string, DatabaseHealthInfo>
  }>

  /**
   * Called by the server when it starts listening. From then on the app's
   * graceful shutdown disconnects databases, after in-flight requests have
   * drained, so the manager's own signal handlers must not close them early.
   */
  static deferShutdownToApp(): void {
    this.appManagedShutdown = true
  }

  /**
   * Registers a database connection lifecycle with the framework.
   */
  static register(db: DatabaseRegistration): void {
    this.databases.set(db.name, { ...db, _connected: false })
    this.ensureShutdownHooks()
  }

  /**
   * Connects all registered databases that are not already connected, in
   * parallel: boot waits for the slowest database, not for the sum of all.
   * If any fail, the error names every database that failed; the ones that
   * connected stay connected, and a later call retries only the failed ones.
   */
  static async connectAll(): Promise<void> {
    const pending = [...this.databases.entries()].filter(
      ([, db]) => !db._connected
    )
    const results = await Promise.allSettled(
      pending.map(async ([, db]) => {
        await db.connect()
        db._connected = true
        db._disconnecting = undefined
      })
    )
    const failures: [string, any][] = []
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        failures.push([pending[i][0], result.reason])
      }
    })
    if (failures.length === 0) return

    const summary = failures
      .map(([name, err]) => `"${name}": ${err?.message ?? String(err)}`)
      .join('; ')
    const error = new Error(
      `[ExisJS Database] Failed to connect database ${summary}`
    )
    ;(error as any).cause = failures[0][1]
    ;(error as any).failures = failures.map(([name, err]) => ({
      name,
      error: err,
    }))
    throw error
  }

  /**
   * Disconnects all registered databases gracefully.
   */
  static async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.databases.values()).map((db) => {
      // Each database is disconnected once: repeated or concurrent calls
      // (signal handler, app.close(), user code) share the first attempt.
      // Drivers such as pg and Neon throw if a pool is ended twice.
      if (!db._disconnecting) {
        db._disconnecting = (async () => {
          try {
            await db.disconnect()
            db._connected = false
          } catch (err: any) {
            console.error(
              `[ExisJS Database] Error disconnecting "${db.name}":`,
              err
            )
          }
        })()
      }
      return db._disconnecting
    })
    await Promise.allSettled(disconnectPromises)
  }

  /**
   * Checks the health of all registered databases, in parallel. Each check
   * has a timeout (`healthTimeoutMs`, default 5 s) so an unresponsive
   * database is reported as an error instead of hanging the probe, and
   * calls made while a check is running share its result, so a burst of
   * probes costs one round of pings.
   */
  static checkHealth(): Promise<{
    healthy: boolean
    databases: Record<string, DatabaseHealthInfo>
  }> {
    if (this.healthInFlight) return this.healthInFlight
    const run = this.runHealthChecks().finally(() => {
      this.healthInFlight = undefined
    })
    this.healthInFlight = run
    return run
  }

  private static async runHealthChecks(): Promise<{
    healthy: boolean
    databases: Record<string, DatabaseHealthInfo>
  }> {
    const entries = await Promise.all(
      [...this.databases].map(([name, db]) => this.checkOne(name, db))
    )
    const databases: Record<string, DatabaseHealthInfo> = {}
    let healthy = true
    for (const info of entries) {
      databases[info.key] = info.result
      if (info.result.status !== 'connected') healthy = false
    }
    return { healthy, databases }
  }

  private static async checkOne(
    name: string,
    db: DatabaseRegistration
  ): Promise<{ key: string; result: DatabaseHealthInfo }> {
    const healthFn = db.isHealthy || db.healthCheck
    if (!healthFn) {
      return { key: name, result: { name, status: 'connected', latencyMs: 0 } }
    }
    const start = Date.now()
    const timeoutMs = db.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS
    try {
      const healthRes = await withTimeout(
        healthFn(),
        timeoutMs,
        `Health check timed out after ${timeoutMs}ms`
      )
      const latencyMs = Date.now() - start
      if (typeof healthRes === 'boolean') {
        return {
          key: name,
          result: {
            name,
            status: healthRes ? 'connected' : 'disconnected',
            latencyMs,
          },
        }
      }
      return {
        key: name,
        result: { latencyMs, ...healthRes, name: healthRes.name || name },
      }
    } catch (err: any) {
      return {
        key: name,
        result: {
          name,
          status: 'error',
          latencyMs: Date.now() - start,
          error: err?.message ?? String(err),
        },
      }
    }
  }

  /**
   * Returns the number of registered databases.
   */
  static get size(): number {
    return this.databases.size
  }

  /**
   * Clears registered databases (useful for testing).
   */
  static clear(): void {
    this.databases.clear()
    this.appManagedShutdown = false
    this.healthInFlight = undefined
  }

  private static ensureShutdownHooks(): void {
    if (this.isShutdownHookRegistered) return
    this.isShutdownHookRegistered = true

    // Only for scripts and workers that register a database without
    // running an HTTP server
    const shutdownHandler = async () => {
      if (DatabaseManager.appManagedShutdown) return
      await DatabaseManager.disconnectAll()
    }

    if (typeof process !== 'undefined' && typeof process.on === 'function') {
      process.once('SIGINT', shutdownHandler)
      process.once('SIGTERM', shutdownHandler)
    }
  }
}

/**
 * Convenience helper to register database lifecycle hooks.
 * Supports both `registerDatabase(options)` and `registerDatabase(app, options)`.
 */
export function registerDatabase(
  appOrDb: any,
  maybeDb?: DatabaseRegistration
): void {
  const db = maybeDb || appOrDb
  DatabaseManager.register(db)
}
