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
}

/**
 * Universal Database Manager for ExisJS.
 * Manages connections, graceful shutdown, and health checks for any database
 * (Mongoose, Prisma, Drizzle, PostgreSQL, MySQL, SQLite, Redis).
 */
export class DatabaseManager {
  private static databases = new Map<string, DatabaseRegistration>()
  private static isShutdownHookRegistered = false

  /**
   * Registers a database connection lifecycle with the framework.
   */
  static register(db: DatabaseRegistration): void {
    this.databases.set(db.name, db)
    this.ensureShutdownHooks()
  }

  /**
   * Connects all registered databases.
   */
  static async connectAll(): Promise<void> {
    for (const [name, db] of this.databases) {
      try {
        await db.connect()
      } catch (err: any) {
        throw new Error(
          `[ExisJS Database] Failed to connect database "${name}": ${err.message}`,
          { cause: err }
        )
      }
    }
  }

  /**
   * Disconnects all registered databases gracefully.
   */
  static async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.databases.values()).map(
      async (db) => {
        try {
          await db.disconnect()
        } catch (err: any) {
          console.error(
            `[ExisJS Database] Error disconnecting "${db.name}":`,
            err
          )
        }
      }
    )
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
        if (!db.isHealthy) {
          results[name] = { name, status: 'connected', latencyMs: 0 }
          continue
        }

        const healthRes = await db.isHealthy()
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
   * Clears registered databases (useful for testing).
   */
  static clear(): void {
    this.databases.clear()
  }

  private static ensureShutdownHooks(): void {
    if (this.isShutdownHookRegistered) return
    this.isShutdownHookRegistered = true

    const shutdownHandler = async () => {
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
 */
export function registerDatabase(db: DatabaseRegistration): void {
  DatabaseManager.register(db)
}
