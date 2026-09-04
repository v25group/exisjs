/**
 * PostgreSQL Database Adapter.
 *
 * Uses the `postgres` (postgres.js) npm package for efficient connection pooling,
 * parameterized queries, and transaction support.
 *
 * Peer Dependencies required:
 *   npm install postgres
 */

import type {
  DatabaseAdapter,
  DatabaseConfig,
  QueryResult,
  ExecuteResult,
  Transaction,
  FieldInfo,
} from '../types'

export class PostgresAdapter implements DatabaseAdapter {
  readonly dialect = 'postgres' as const

  private client: any = null
  private config: DatabaseConfig

  constructor(config: DatabaseConfig) {
    this.config = config
  }

  async connect(): Promise<void> {
    let postgres: any

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      postgres = require('postgres')
    } catch {
      throw new Error('Missing dependency. Please run: npm install postgres')
    }

    const url = this.config.url || this.buildConnectionUrl()
    const poolConfig = this.config.pool || {}

    this.client = postgres(url, {
      max: poolConfig.max ?? 10,
      idle_timeout: poolConfig.idleTimeoutMs
        ? poolConfig.idleTimeoutMs / 1000
        : 30,
      connect_timeout: this.config.connectTimeoutMs
        ? this.config.connectTimeoutMs / 1000
        : 5,
      ssl:
        this.config.ssl === true
          ? { rejectUnauthorized: process.env.NODE_ENV === 'production' }
          : typeof this.config.ssl === 'object'
            ? this.config.ssl
            : undefined,
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onnotice: () => {}, // Suppress notices
    })

    // Test the connection
    await this.client`SELECT 1`

    this.log('PostgreSQL connection established')
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end()
      this.client = null
      this.log('PostgreSQL connection closed')
    }
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    this.ensureConnected()
    this.logQuery(sql, params)

    const result = await this.client.unsafe(sql, params)

    const fields: FieldInfo[] = result.columns
      ? result.columns.map((col: any) => ({
          name: col.name,
          dataType: col.type?.toString(),
          tableId: col.table,
        }))
      : []

    return {
      rows: Array.from(result) as T[],
      rowCount: result.length,
      fields,
    }
  }

  async execute(sql: string, params: unknown[] = []): Promise<ExecuteResult> {
    this.ensureConnected()
    this.logQuery(sql, params)

    const result = await this.client.unsafe(sql, params)

    return {
      affectedRows: result.count ?? 0,
      insertId: result[0]?.id,
    }
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    this.ensureConnected()

    return this.client.begin(async (sql: any) => {
      const tx: Transaction = {
        query: async <R = Record<string, unknown>>(
          queryStr: string,
          params: unknown[] = []
        ): Promise<QueryResult<R>> => {
          this.logQuery(queryStr, params)
          const result = await sql.unsafe(queryStr, params)
          const fields: FieldInfo[] = result.columns
            ? result.columns.map((col: any) => ({
                name: col.name,
                dataType: col.type?.toString(),
                tableId: col.table,
              }))
            : []
          return {
            rows: Array.from(result) as R[],
            rowCount: result.length,
            fields,
          }
        },

        execute: async (
          queryStr: string,
          params: unknown[] = []
        ): Promise<ExecuteResult> => {
          this.logQuery(queryStr, params)
          const result = await sql.unsafe(queryStr, params)
          return {
            affectedRows: result.count ?? 0,
            insertId: result[0]?.id,
          }
        },

        savepoint: async (name: string): Promise<void> => {
          await sql.unsafe(`SAVEPOINT ${name}`)
        },

        rollbackTo: async (name: string): Promise<void> => {
          await sql.unsafe(`ROLLBACK TO SAVEPOINT ${name}`)
        },

        commit: async (): Promise<void> => {
          // postgres.js handles commit automatically when the callback resolves
        },

        rollback: async (): Promise<void> => {
          throw new Error('ROLLBACK')
        },
      }

      return fn(tx)
    })
  }

  async isHealthy(): Promise<boolean> {
    try {
      this.ensureConnected()
      await this.client`SELECT 1`
      return true
    } catch {
      return false
    }
  }

  getRawClient(): unknown {
    return this.client
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.client) {
      throw new Error(
        'PostgreSQL adapter is not connected. Call connect() first.'
      )
    }
  }

  private buildConnectionUrl(): string {
    const { host, port, database, username, password } = this.config
    if (!host || !database) {
      throw new Error(
        'PostgreSQL requires either a `url` or `host` + `database` in the config.'
      )
    }
    const auth = username
      ? password
        ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
        : `${encodeURIComponent(username)}@`
      : ''
    return `postgres://${auth}${host}:${port || 5432}/${database}`
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
