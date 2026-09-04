/**
 * MySQL Database Adapter.
 *
 * Uses the `mysql2` npm package for efficient prepared statements,
 * connection pooling, and transaction support.
 *
 * Peer Dependencies required:
 *   npm install mysql2
 */

import type {
  DatabaseAdapter,
  DatabaseConfig,
  QueryResult,
  ExecuteResult,
  Transaction,
  FieldInfo,
} from '../types'

export class MysqlAdapter implements DatabaseAdapter {
  readonly dialect = 'mysql' as const

  private pool: any = null
  private config: DatabaseConfig

  constructor(config: DatabaseConfig) {
    this.config = config
  }

  async connect(): Promise<void> {
    let mysql: any

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mysql = require('mysql2/promise')
    } catch {
      throw new Error('Missing dependency. Please run: npm install mysql2')
    }

    const poolConfig = this.config.pool || {}

    if (this.config.url) {
      this.pool = mysql.createPool({
        uri: this.config.url,
        waitForConnections: true,
        connectionLimit: poolConfig.max ?? 10,
        idleTimeout: poolConfig.idleTimeoutMs ?? 30000,
        connectTimeout: this.config.connectTimeoutMs ?? 5000,
        ssl:
          this.config.ssl === true
            ? {}
            : typeof this.config.ssl === 'object'
              ? this.config.ssl
              : undefined,
      })
    } else {
      this.pool = mysql.createPool({
        host: this.config.host || 'localhost',
        port: this.config.port || 3306,
        database: this.config.database,
        user: this.config.username,
        password: this.config.password,
        waitForConnections: true,
        connectionLimit: poolConfig.max ?? 10,
        idleTimeout: poolConfig.idleTimeoutMs ?? 30000,
        connectTimeout: this.config.connectTimeoutMs ?? 5000,
        ssl:
          this.config.ssl === true
            ? {}
            : typeof this.config.ssl === 'object'
              ? this.config.ssl
              : undefined,
      })
    }

    // Test the connection
    const conn = await this.pool.getConnection()
    conn.release()

    this.log('MySQL connection pool established')
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end()
      this.pool = null
      this.log('MySQL connection pool closed')
    }
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    this.ensureConnected()
    this.logQuery(sql, params)

    const [rows, columns] = await this.pool.execute(sql, params)

    const fields: FieldInfo[] = Array.isArray(columns)
      ? columns.map((col: any) => ({
          name: col.name,
          dataType: col.type?.toString(),
          tableId: col.table?.length ? undefined : undefined,
        }))
      : []

    return {
      rows: rows as T[],
      rowCount: Array.isArray(rows) ? rows.length : 0,
      fields,
    }
  }

  async execute(sql: string, params: unknown[] = []): Promise<ExecuteResult> {
    this.ensureConnected()
    this.logQuery(sql, params)

    const [result] = await this.pool.execute(sql, params)

    return {
      affectedRows: result.affectedRows ?? 0,
      insertId: result.insertId ?? undefined,
    }
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    this.ensureConnected()

    const conn = await this.pool.getConnection()

    try {
      await conn.beginTransaction()

      const tx: Transaction = {
        query: async <R = Record<string, unknown>>(
          queryStr: string,
          params: unknown[] = []
        ): Promise<QueryResult<R>> => {
          this.logQuery(queryStr, params)
          const [rows, columns] = await conn.execute(queryStr, params)
          const fields: FieldInfo[] = Array.isArray(columns)
            ? columns.map((col: any) => ({
                name: col.name,
                dataType: col.type?.toString(),
              }))
            : []
          return {
            rows: rows as R[],
            rowCount: Array.isArray(rows) ? rows.length : 0,
            fields,
          }
        },

        execute: async (
          queryStr: string,
          params: unknown[] = []
        ): Promise<ExecuteResult> => {
          this.logQuery(queryStr, params)
          const [result] = await conn.execute(queryStr, params)
          return {
            affectedRows: result.affectedRows ?? 0,
            insertId: result.insertId ?? undefined,
          }
        },

        savepoint: async (name: string): Promise<void> => {
          await conn.execute(`SAVEPOINT ${name}`)
        },

        rollbackTo: async (name: string): Promise<void> => {
          await conn.execute(`ROLLBACK TO SAVEPOINT ${name}`)
        },

        commit: async (): Promise<void> => {
          await conn.commit()
        },

        rollback: async (): Promise<void> => {
          await conn.rollback()
        },
      }

      const result = await fn(tx)
      await conn.commit()
      return result
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      this.ensureConnected()
      await this.pool.execute('SELECT 1')
      return true
    } catch {
      return false
    }
  }

  getRawClient(): unknown {
    return this.pool
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.pool) {
      throw new Error('MySQL adapter is not connected. Call connect() first.')
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
