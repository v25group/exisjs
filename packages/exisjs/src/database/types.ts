// ─── Database Layer Types ──────────────────────────────────────────────────────

/**
 * Supported database dialects.
 */
export type DatabaseDialect = 'postgres' | 'mysql' | 'sqlite' | 'mongodb'

/**
 * Connection pool configuration.
 */
export interface PoolConfig {
  /** Minimum number of connections in the pool. Default: 2 */
  min?: number
  /** Maximum number of connections in the pool. Default: 10 */
  max?: number
  /** Time in ms a connection can sit idle before being closed. Default: 30000 */
  idleTimeoutMs?: number
  /** Time in ms to wait for a connection from the pool. Default: 10000 */
  acquireTimeoutMs?: number
}

/**
 * SSL/TLS configuration for database connections.
 */
export interface DatabaseSslConfig {
  /** Reject unauthorized certificates. Default: true in production */
  rejectUnauthorized?: boolean
  /** Path to CA certificate */
  ca?: string | Buffer
  /** Path to client certificate */
  cert?: string | Buffer
  /** Path to client private key */
  key?: string | Buffer
}

/**
 * Configuration for a database connection.
 */
export interface DatabaseConfig {
  /** The database dialect to use */
  dialect: DatabaseDialect
  /** Connection URL (e.g. postgres://user:pass@host:5432/dbname) */
  url?: string
  /** Host address. Used if `url` is not provided */
  host?: string
  /** Port number */
  port?: number
  /** Database name */
  database?: string
  /** Username for authentication */
  username?: string
  /** Password for authentication */
  password?: string
  /** Connection pool configuration */
  pool?: PoolConfig
  /** SSL/TLS configuration. Set to true for default SSL, or provide detailed config */
  ssl?: boolean | DatabaseSslConfig
  /** Enable query logging. Default: false */
  logging?: boolean | ((sql: string, params?: unknown[]) => void)
  /** Connection timeout in milliseconds. Default: 5000 */
  connectTimeoutMs?: number
  /**
   * Path to the SQLite database file.
   * Use ':memory:' for in-memory databases.
   * Only applicable when dialect is 'sqlite'.
   */
  filename?: string
  /**
   * MongoDB-specific: the authentication database.
   * Only applicable when dialect is 'mongodb'.
   */
  authSource?: string
}

/**
 * Metadata about a column in a query result.
 */
export interface FieldInfo {
  name: string
  dataType?: string
  tableId?: number
}

/**
 * Result of a SELECT query.
 */
export interface QueryResult<T = Record<string, unknown>> {
  /** The rows returned by the query */
  rows: T[]
  /** Number of rows returned */
  rowCount: number
  /** Column metadata */
  fields: FieldInfo[]
}

/**
 * Result of an INSERT, UPDATE, or DELETE statement.
 */
export interface ExecuteResult {
  /** Number of rows affected by the statement */
  affectedRows: number
  /** The auto-generated ID of the last inserted row (if applicable) */
  insertId?: string | number
}

/**
 * A transaction context for executing multiple queries atomically.
 */
export interface Transaction {
  /** Execute a SELECT query within this transaction */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>
  /** Execute an INSERT, UPDATE, or DELETE within this transaction */
  execute(sql: string, params?: unknown[]): Promise<ExecuteResult>
  /** Create a savepoint within this transaction */
  savepoint(name: string): Promise<void>
  /** Rollback to a specific savepoint */
  rollbackTo(name: string): Promise<void>
  /** Explicitly commit this transaction (usually handled automatically) */
  commit(): Promise<void>
  /** Explicitly rollback this transaction */
  rollback(): Promise<void>
}

/**
 * The contract that every database adapter must implement.
 */
export interface DatabaseAdapter {
  /** The dialect this adapter handles */
  readonly dialect: DatabaseDialect

  /** Establish the database connection / pool */
  connect(): Promise<void>

  /** Gracefully close all connections */
  disconnect(): Promise<void>

  /** Execute a SELECT query and return typed results */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>

  /** Execute an INSERT, UPDATE, or DELETE statement */
  execute(sql: string, params?: unknown[]): Promise<ExecuteResult>

  /**
   * Execute a series of operations within an atomic transaction.
   * The transaction is committed if the callback resolves, rolled back if it rejects.
   */
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>

  /** Check if the database connection is alive and healthy */
  isHealthy(): Promise<boolean>

  /** Get the underlying raw client (for advanced use cases) */
  getRawClient(): unknown
}

// ─── Migration Types ────────────────────────────────────────────────────────────

/**
 * Represents a single database migration.
 */
export interface Migration {
  /** Unique migration name (e.g. '001_create_users_table') */
  name: string
  /** Apply the migration */
  up(adapter: DatabaseAdapter): Promise<void>
  /** Revert the migration */
  down(adapter: DatabaseAdapter): Promise<void>
}

/**
 * Configuration for the built-in migration system.
 */
export interface MigrationConfig {
  /** Directory containing migration files. Default: './migrations' */
  directory?: string
  /** Name of the migrations tracking table. Default: '_exis_migrations' */
  tableName?: string
}

/**
 * Record of an applied migration, stored in the tracking table.
 */
export interface MigrationRecord {
  name: string
  appliedAt: Date
  batch: number
}

// ─── Query Builder Types ────────────────────────────────────────────────────────

export type WhereOperator =
  | '='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='
  | 'LIKE'
  | 'ILIKE'
  | 'IN'
  | 'NOT IN'
  | 'IS'
  | 'IS NOT'
  | 'BETWEEN'

export type OrderDirection = 'asc' | 'desc' | 'ASC' | 'DESC'

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'

export interface WhereClause {
  column: string
  operator: WhereOperator
  value: unknown
  conjunction: 'AND' | 'OR'
}

export interface JoinClause {
  type: JoinType
  table: string
  on: string
}

export interface OrderByClause {
  column: string
  direction: OrderDirection
}
