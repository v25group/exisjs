/**
 * Database Manager.
 *
 * The central orchestrator for all database connections. Manages named connections,
 * provides lifecycle integration with the ExisJS app (auto-disconnect on shutdown),
 * and exposes the query builder, raw query execution, and migration system.
 *
 * Usage:
 *   import { db, createDatabase } from 'exisjs/database'
 *
 *   // Quick setup
 *   const database = createDatabase({ dialect: 'postgres', url: process.env.DATABASE_URL })
 *   await database.connect()
 *
 *   // Query
 *   const users = await database.query<User>('SELECT * FROM users')
 *   const admins = await database.table('users').where('role', '=', 'admin').rows()
 */

import type {
  DatabaseAdapter,
  DatabaseConfig,
  DatabaseDialect,
  QueryResult,
  ExecuteResult,
  Transaction,
  MigrationConfig,
} from './types'
import { QueryBuilder } from './query-builder'
import { Migrator } from './migration'
import { SchemaSynchronizer } from './synchronizer'
import type { TableDefinition } from './sql/schema'

/**
 * Create a database adapter for the given dialect.
 */
function createAdapter(config: DatabaseConfig): DatabaseAdapter {
  switch (config.dialect) {
    case 'postgres': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PostgresAdapter } = require('./adapters/postgres')
      return new PostgresAdapter(config)
    }
    case 'mysql': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MysqlAdapter } = require('./adapters/mysql')
      return new MysqlAdapter(config)
    }
    case 'sqlite': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SqliteAdapter } = require('./adapters/sqlite')
      return new SqliteAdapter(config)
    }
    case 'mongodb': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MongodbAdapter } = require('./adapters/mongodb')
      return new MongodbAdapter(config)
    }
    default:
      throw new Error(
        `Unsupported database dialect: ${(config as any).dialect}`
      )
  }
}

export class DatabaseManager {
  private connections = new Map<string, DatabaseAdapter>()
  private configs = new Map<string, DatabaseConfig>()
  private defaultName = 'default'
  private migrator: Migrator | null = null
  private synchronizer: SchemaSynchronizer | null = null
  private registeredSchemas: TableDefinition[] = []

  /**
   * Add a named database connection.
   * The first connection added becomes the default.
   */
  addConnection(config: DatabaseConfig, name?: string): this {
    const connName = name || this.defaultName
    const adapter = createAdapter(config)
    this.connections.set(connName, adapter)
    this.configs.set(connName, config)
    return this
  }

  /**
   * Connect all registered connections (or a specific named connection).
   */
  async connect(name?: string): Promise<void> {
    if (name) {
      const adapter = this.getAdapter(name)
      await adapter.connect()
      this.registerShutdownHook()
      return
    }

    const promises: Promise<void>[] = []
    for (const [, adapter] of this.connections) {
      promises.push(adapter.connect())
    }
    await Promise.all(promises)
    this.registerShutdownHook()

    // Auto-sync if configured
    for (const [name, config] of this.configs) {
      if ((config as any).autoSync) {
        await this.sync(name)
      }
    }
  }

  /**
   * Disconnect all connections (or a specific named connection).
   */
  async disconnect(name?: string): Promise<void> {
    if (name) {
      const adapter = this.connections.get(name)
      if (adapter) {
        await adapter.disconnect()
        this.connections.delete(name)
        this.configs.delete(name)
      }
      return
    }

    const promises: Promise<void>[] = []
    for (const [, adapter] of this.connections) {
      promises.push(adapter.disconnect())
    }
    await Promise.all(promises)
    this.connections.clear()
    this.configs.clear()
    this.registeredSchemas = []
  }

  // ─── SQL-First Schema ──────────────────────────────────────────────────────

  /**
   * Register SQL-First Table Definitions to be auto-synced.
   */
  registerSchema(tables: TableDefinition[]): this {
    this.registeredSchemas.push(...tables)
    return this
  }

  /**
   * Run the Auto-Sync Engine to automatically CREATE/ALTER tables.
   */
  async sync(connectionName?: string): Promise<void> {
    if (this.registeredSchemas.length === 0) return
    const adapter = this.getAdapter(connectionName || this.defaultName)
    if (!this.synchronizer) {
      this.synchronizer = new SchemaSynchronizer(adapter)
    }
    await this.synchronizer.sync(this.registeredSchemas)
  }

  /**
   * Execute a SELECT query on the default (or named) connection.
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
    connectionName?: string
  ): Promise<QueryResult<T>> {
    const adapter = this.getAdapter(connectionName || this.defaultName)
    return adapter.query<T>(sql, params)
  }

  /**
   * Execute an INSERT, UPDATE, or DELETE on the default (or named) connection.
   */
  async execute(
    sql: string,
    params?: unknown[],
    connectionName?: string
  ): Promise<ExecuteResult> {
    const adapter = this.getAdapter(connectionName || this.defaultName)
    return adapter.execute(sql, params)
  }

  /**
   * Execute a series of operations within an atomic transaction.
   */
  async transaction<T>(
    fn: (tx: Transaction) => Promise<T>,
    connectionName?: string
  ): Promise<T> {
    const adapter = this.getAdapter(connectionName || this.defaultName)
    return adapter.transaction(fn)
  }

  /**
   * Start building a query for a table (chainable query builder).
   */
  table<T = Record<string, unknown>>(
    tableName: string | any,
    connectionName?: string
  ): QueryBuilder<T> {
    const name = typeof tableName === 'string' ? tableName : tableName.tableName
    const adapter = this.getAdapter(connectionName || this.defaultName)
    return new QueryBuilder<T>(adapter, name)
  }

  // ─── SQL-First API ─────────────────────────────────────────────────────────

  /**
   * Start a SELECT query. Use .from(table) to specify the table.
   */
  select(...columns: string[]): QueryBuilder<any> {
    const adapter = this.getAdapter(this.defaultName)
    const qb = new QueryBuilder<any>(adapter, '')
    return qb.select(...columns)
  }

  /**
   * Start an INSERT query.
   */
  insert(tableDef: any): QueryBuilder<any> {
    const name = typeof tableDef === 'string' ? tableDef : tableDef.tableName
    const adapter = this.getAdapter(this.defaultName)
    const qb = new QueryBuilder<any>(adapter, name)
    // We override the default operation which is select
    return qb.setOperation('insert')
  }

  /**
   * Start an UPDATE query.
   */
  update(tableDef: any): QueryBuilder<any> {
    const name = typeof tableDef === 'string' ? tableDef : tableDef.tableName
    const adapter = this.getAdapter(this.defaultName)
    const qb = new QueryBuilder<any>(adapter, name)
    return qb.setOperation('update')
  }

  /**
   * Start a DELETE query.
   */
  delete(tableDef: any): QueryBuilder<any> {
    const name = typeof tableDef === 'string' ? tableDef : tableDef.tableName
    const adapter = this.getAdapter(this.defaultName)
    const qb = new QueryBuilder<any>(adapter, name)
    return qb.setOperation('delete')
  }

  /**
   * Check if a connection is healthy.
   */
  async isHealthy(connectionName?: string): Promise<boolean> {
    const adapter = this.connections.get(connectionName || this.defaultName)
    if (!adapter) return false
    return adapter.isHealthy()
  }

  /**
   * Check health of all connections.
   */
  async healthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {}
    for (const [name, adapter] of this.connections) {
      try {
        results[name] = await adapter.isHealthy()
      } catch {
        results[name] = false
      }
    }
    return results
  }

  /**
   * Get the raw adapter for a connection (for advanced use cases).
   */
  getAdapter(name?: string): DatabaseAdapter {
    const connName = name || this.defaultName
    const adapter = this.connections.get(connName)
    if (!adapter) {
      throw new Error(
        `Database connection '${connName}' not found. Did you call addConnection() and connect()?`
      )
    }
    return adapter
  }

  /**
   * Get the raw underlying client for a connection.
   */
  getRawClient(name?: string): unknown {
    return this.getAdapter(name).getRawClient()
  }

  /**
   * Get the dialect of a connection.
   */
  getDialect(name?: string): DatabaseDialect {
    return this.getAdapter(name).dialect
  }

  /**
   * Get the migration system for the default connection.
   */
  getMigrator(config?: MigrationConfig, connectionName?: string): Migrator {
    if (!this.migrator || connectionName) {
      const adapter = this.getAdapter(connectionName || this.defaultName)
      this.migrator = new Migrator(adapter, config)
    }
    return this.migrator
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private shutdownRegistered = false

  private registerShutdownHook(): void {
    if (this.shutdownRegistered) return
    this.shutdownRegistered = true

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getActiveApp } = require('../server/app')
      const app = getActiveApp()
      if (app && typeof app.onShutdown === 'function') {
        app.onShutdown(async () => {
          await this.disconnect()
        })
      }
    } catch {
      // Not in an app context — user must disconnect manually
    }
  }
}

// ─── Factory & Singleton ─────────────────────────────────────────────────────

let defaultManager: DatabaseManager | null = null

/**
 * Create a new DatabaseManager with the given configuration.
 * This is the recommended way to set up a database connection.
 *
 * @example
 * ```ts
 * const db = createDatabase({
 *   dialect: 'postgres',
 *   url: process.env.DATABASE_URL,
 * })
 * await db.connect()
 * ```
 */
export function createDatabase(config: DatabaseConfig): DatabaseManager {
  const manager = new DatabaseManager()
  manager.addConnection(config)

  // Set as the global default if none exists
  if (!defaultManager) {
    defaultManager = manager
  }

  return manager
}

/**
 * Lazy-initialized global database proxy.
 * Forwards all calls to the default DatabaseManager.
 *
 * @example
 * ```ts
 * import { db } from 'exisjs/database'
 *
 * // After createDatabase() has been called elsewhere:
 * const users = await db.query('SELECT * FROM users')
 * ```
 */
export const db: DatabaseManager = new Proxy({} as DatabaseManager, {
  get(_target, prop) {
    if (!defaultManager) {
      throw new Error(
        'No database has been configured. Call createDatabase() first.'
      )
    }
    const value = (defaultManager as any)[prop]
    return typeof value === 'function' ? value.bind(defaultManager) : value
  },
})

/**
 * Set or replace the default DatabaseManager.
 */
export function setDefaultDatabase(manager: DatabaseManager): void {
  defaultManager = manager
}
