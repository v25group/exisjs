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
   * Connects all registered databases that are not already connected.
   */
  static async connectAll(): Promise<void> {
    for (const [name, db] of this.databases) {
      if (db._connected) continue
      try {
        await db.connect()
        db._connected = true
        db._disconnecting = undefined
      } catch (err: any) {
        const error = new Error(
          `[ExisJS Database] Failed to connect database "${name}": ${err.message}`
        )
        ;(error as any).cause = err
        throw error
      }
    }
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
   * Checks the health of all registered databases.
   */
  static async checkHealth(): Promise<{
    healthy: boolean
    databases: Record<string, DatabaseHealthInfo>
  }> {
    const results: Record<string, DatabaseHealthInfo> = {}
    let allHealthy = true

    for (const [name, db] of this.databases) {
      const start = Date.now()
      try {
        const healthFn = db.isHealthy || db.healthCheck
        if (!healthFn) {
          results[name] = { name, status: 'connected', latencyMs: 0 }
          continue
        }

        const healthRes = await healthFn()
        const latencyMs = Date.now() - start

        if (typeof healthRes === 'boolean') {
          results[name] = {
            name,
            status: healthRes ? 'connected' : 'disconnected',
            latencyMs,
          }
          if (!healthRes) allHealthy = false
        } else {
          results[name] = {
            latencyMs,
            ...healthRes,
            name: healthRes.name || name,
          }
          if (healthRes.status !== 'connected') allHealthy = false
        }
      } catch (err: any) {
        allHealthy = false
        results[name] = {
          name,
          status: 'error',
          latencyMs: Date.now() - start,
          error: err.message,
        }
      }
    }

    return {
      healthy: allHealthy,
      databases: results,
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
