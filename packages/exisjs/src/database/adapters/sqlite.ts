/**
 * SQLite Database Adapter.
 *
 * Uses the `better-sqlite3` npm package for efficient synchronous
 * SQLite operations, wrapped in an async interface for consistency.
 *
 * Peer Dependencies required:
 *   npm install better-sqlite3
 */

import type {
  DatabaseAdapter,
  DatabaseConfig,
  QueryResult,
  ExecuteResult,
  Transaction,
  FieldInfo,
} from '../types'

export class SqliteAdapter implements DatabaseAdapter {
  readonly dialect = 'sqlite' as const

  private db: any = null
  private config: DatabaseConfig

  constructor(config: DatabaseConfig) {
    this.config = config
  }

  async connect(): Promise<void> {
    let Database: any

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      Database = require('better-sqlite3')
    } catch {
      throw new Error(
        'Missing dependency. Please run: npm install better-sqlite3'
      )
    }

    const filename = this.config.filename || this.config.database || ':memory:'

    this.db = new Database(filename, {
      timeout: this.config.connectTimeoutMs ?? 5000,
    })

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL')
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON')

    this.log(`SQLite connection established (${filename})`)
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
      this.log('SQLite connection closed')
    }
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    this.ensureConnected()
    this.logQuery(sql, params)

    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params) as T[]

    const fields: FieldInfo[] = stmt.columns
      ? stmt.columns().map((col: any) => ({
          name: col.name,
          dataType: col.type || undefined,
        }))
      : []

    return {
      rows,
      rowCount: rows.length,
      fields,
    }
  }

  async execute(sql: string, params: unknown[] = []): Promise<ExecuteResult> {
    this.ensureConnected()
    this.logQuery(sql, params)

    const stmt = this.db.prepare(sql)
    const result = stmt.run(...params)

    return {
      affectedRows: result.changes,
      insertId: result.lastInsertRowid
        ? Number(result.lastInsertRowid)
        : undefined,
    }
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    this.ensureConnected()

    // better-sqlite3 has synchronous transactions, but we wrap for async consistency
    const tx: Transaction = {
      query: async <R = Record<string, unknown>>(
        queryStr: string,
        params: unknown[] = []
      ): Promise<QueryResult<R>> => {
        return this.query<R>(queryStr, params)
      },

      execute: async (
        queryStr: string,
        params: unknown[] = []
      ): Promise<ExecuteResult> => {
        return this.execute(queryStr, params)
      },

      savepoint: async (name: string): Promise<void> => {
        this.db.exec(`SAVEPOINT ${name}`)
      },

      rollbackTo: async (name: string): Promise<void> => {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${name}`)
      },

      commit: async (): Promise<void> => {
        // Handled by the wrapping transaction
      },

      rollback: async (): Promise<void> => {
        throw new Error('ROLLBACK')
      },
    }

    // Use better-sqlite3's transaction wrapper for atomic execution
    try {
      this.db.exec('BEGIN')
      const result = await fn(tx)
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // Already rolled back
      }
      throw err
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      this.ensureConnected()
      this.db.prepare('SELECT 1').get()
      return true
    } catch {
      return false
    }
  }

  getRawClient(): unknown {
    return this.db
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.db) {
      throw new Error('SQLite adapter is not connected. Call connect() first.')
    }
  }

  private logQuery(sql: string, params?: unknown[]): void {
    if (!this.config.logging) return
    if (typeof this.config.logging === 'function') {
      this.config.logging(sql, params)
    }
  }

  private log(message: string): void {
    if (!this.config.logging) return
    if (typeof this.config.logging === 'function') {
      this.config.logging(message)
    }
  }
}
