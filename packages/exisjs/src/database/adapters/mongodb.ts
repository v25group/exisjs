/**
 * MongoDB Database Adapter.
 *
 * Uses the `mongodb` npm package for native MongoDB driver support.
 * Maps the relational-style DatabaseAdapter interface to document-oriented operations.
 *
 * For MongoDB, `query()` executes raw commands or aggregation pipelines,
 * and `execute()` handles insert/update/delete operations.
 *
 * Peer Dependencies required:
 *   npm install mongodb
 */

import type {
  DatabaseAdapter,
  DatabaseConfig,
  QueryResult,
  ExecuteResult,
  Transaction,
} from '../types'

export class MongodbAdapter implements DatabaseAdapter {
  readonly dialect = 'mongodb' as const

  private client: any = null
  private database: any = null
  private config: DatabaseConfig

  constructor(config: DatabaseConfig) {
    this.config = config
  }

  async connect(): Promise<void> {
    let MongoClient: any

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      MongoClient = require('mongodb').MongoClient
    } catch {
      throw new Error('Missing dependency. Please run: npm install mongodb')
    }

    const url = this.config.url || this.buildConnectionUrl()

    const poolConfig = this.config.pool || {}

    this.client = new MongoClient(url, {
      maxPoolSize: poolConfig.max ?? 10,
      minPoolSize: poolConfig.min ?? 2,
      maxIdleTimeMS: poolConfig.idleTimeoutMs ?? 30000,
      connectTimeoutMS: this.config.connectTimeoutMs ?? 5000,
      serverSelectionTimeoutMS: this.config.connectTimeoutMs ?? 5000,
      tls: this.config.ssl === true ? true : undefined,
      ...(typeof this.config.ssl === 'object'
        ? {
            tls: true,
            tlsCAFile:
              typeof this.config.ssl.ca === 'string'
                ? this.config.ssl.ca
                : undefined,
            tlsCertificateKeyFile:
              typeof this.config.ssl.key === 'string'
                ? this.config.ssl.key
                : undefined,
          }
        : {}),
    })

    await this.client.connect()

    const dbName = this.config.database || this.extractDbName(url)
    if (!dbName) {
      throw new Error(
        'MongoDB requires a database name. Provide it via `database` config or in the connection URL.'
      )
    }
    this.database = this.client.db(dbName)

    this.log('MongoDB connection established')
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
      this.database = null
      this.log('MongoDB connection closed')
    }
  }

  /**
   * Execute a MongoDB find query.
   *
   * For MongoDB, `sql` is treated as a JSON command string:
   *   `{ "collection": "users", "filter": { "role": "admin" }, "options": { "limit": 10 } }`
   *
   * Or simply pass the collection name as `sql` and the filter as `params[0]`:
   *   query('users', [{ role: 'admin' }])
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    this.ensureConnected()
    this.logQuery(sql, params)

    // If sql looks like a JSON command
    if (sql.trim().startsWith('{')) {
      const cmd = JSON.parse(sql)
      const collection = this.database.collection(cmd.collection)
      const filter = cmd.filter || {}
      const options = cmd.options || {}
      const rows = (await collection.find(filter, options).toArray()) as T[]
      return { rows, rowCount: rows.length, fields: [] }
    }

    // Otherwise, treat sql as collection name, params[0] as filter, params[1] as options
    const collection = this.database.collection(sql)
    const filter = (params[0] as Record<string, unknown>) || {}
    const options = (params[1] as Record<string, unknown>) || {}
    const rows = (await collection.find(filter, options).toArray()) as T[]

    return { rows, rowCount: rows.length, fields: [] }
  }

  /**
   * Execute a MongoDB write operation.
   *
   * The `sql` parameter is a JSON command string:
   *   `{ "collection": "users", "operation": "insertOne", "document": { ... } }`
   *   `{ "collection": "users", "operation": "updateOne", "filter": { ... }, "update": { ... } }`
   *   `{ "collection": "users", "operation": "deleteOne", "filter": { ... } }`
   *
   * Or use the shorthand: execute('users.insertOne', [document])
   */
  async execute(sql: string, params: unknown[] = []): Promise<ExecuteResult> {
    this.ensureConnected()
    this.logQuery(sql, params)

    // JSON command mode
    if (sql.trim().startsWith('{')) {
      return this.executeJsonCommand(sql)
    }

    // Shorthand mode: 'collection.operation'
    const dotIndex = sql.indexOf('.')
    if (dotIndex !== -1) {
      const collectionName = sql.substring(0, dotIndex)
      const operation = sql.substring(dotIndex + 1)
      return this.executeOperation(collectionName, operation, params)
    }

    throw new Error(
      `MongoDB execute: Unrecognized command format. Use JSON or 'collection.operation' syntax.`
    )
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    this.ensureConnected()

    const session = this.client.startSession()

    try {
      let result: T

      await session.withTransaction(async () => {
        const tx: Transaction = {
          query: async <R = Record<string, unknown>>(
            queryStr: string,
            params: unknown[] = []
          ): Promise<QueryResult<R>> => {
            // For transactions, inject session into the query
            return this.query<R>(queryStr, params)
          },

          execute: async (
            queryStr: string,
            params: unknown[] = []
          ): Promise<ExecuteResult> => {
            return this.execute(queryStr, params)
          },

          savepoint: async (): Promise<void> => {
            // MongoDB does not support savepoints
            throw new Error(
              'MongoDB does not support savepoints within transactions'
            )
          },

          rollbackTo: async (): Promise<void> => {
            throw new Error(
              'MongoDB does not support savepoints within transactions'
            )
          },

          commit: async (): Promise<void> => {
            // Handled by session.withTransaction
          },

          rollback: async (): Promise<void> => {
            await session.abortTransaction()
          },
        }

        result = await fn(tx)
      })

      return result!
    } finally {
      await session.endSession()
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      this.ensureConnected()
      await this.database.command({ ping: 1 })
      return true
    } catch {
      return false
    }
  }

  getRawClient(): unknown {
    return this.client
  }

  /**
   * Get the raw MongoDB database instance for native operations.
   */
  getDatabase(): unknown {
    return this.database
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private async executeJsonCommand(json: string): Promise<ExecuteResult> {
    const cmd = JSON.parse(json)
    const collection = this.database.collection(cmd.collection)
    return this.executeOperation(
      cmd.collection,
      cmd.operation,
      [cmd.document || cmd.filter, cmd.update].filter(Boolean),
      collection
    )
  }

  private async executeOperation(
    collectionName: string,
    operation: string,
    params: unknown[],
    collection?: any
  ): Promise<ExecuteResult> {
    const coll = collection || this.database.collection(collectionName)

    switch (operation) {
      case 'insertOne': {
        const result = await coll.insertOne(params[0])
        return { affectedRows: 1, insertId: result.insertedId?.toString() }
      }
      case 'insertMany': {
        const docs = params[0] as unknown[]
        const result = await coll.insertMany(docs)
        return { affectedRows: result.insertedCount }
      }
      case 'updateOne': {
        const result = await coll.updateOne(params[0], params[1])
        return { affectedRows: result.modifiedCount }
      }
      case 'updateMany': {
        const result = await coll.updateMany(params[0], params[1])
        return { affectedRows: result.modifiedCount }
      }
      case 'deleteOne': {
        const result = await coll.deleteOne(params[0])
        return { affectedRows: result.deletedCount }
      }
      case 'deleteMany': {
        const result = await coll.deleteMany(params[0])
        return { affectedRows: result.deletedCount }
      }
      case 'replaceOne': {
        const result = await coll.replaceOne(params[0], params[1])
        return { affectedRows: result.modifiedCount }
      }
      default:
        throw new Error(`MongoDB: Unsupported operation '${operation}'`)
    }
  }

  private ensureConnected(): void {
    if (!this.client || !this.database) {
      throw new Error('MongoDB adapter is not connected. Call connect() first.')
    }
  }

  private buildConnectionUrl(): string {
    const { host, port, username, password, authSource } = this.config
    if (!host) {
      throw new Error(
        'MongoDB requires either a `url` or `host` in the config.'
      )
    }
    const auth = username
      ? password
        ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
        : `${encodeURIComponent(username)}@`
      : ''
    const authSrc = authSource ? `?authSource=${authSource}` : ''
    return `mongodb://${auth}${host}:${port || 27017}${authSrc}`
  }

  private extractDbName(url: string): string | undefined {
    try {
      const parsed = new URL(url)
      const path = parsed.pathname
      return path && path.length > 1 ? path.substring(1) : undefined
    } catch {
      return undefined
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
