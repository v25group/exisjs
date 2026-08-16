/**
 * ExisJS Database Layer
 *
 * A unified database abstraction providing connection pooling, query building,
 * transactions, migrations, and multi-dialect support.
 *
 * @example
 * ```ts
 * import { createDatabase, db } from 'exisjs/database'
 *
 * const database = createDatabase({
 *   dialect: 'postgres',
 *   url: process.env.DATABASE_URL,
 * })
 * await database.connect()
 *
 * // Raw queries
 * const users = await db.query<User>('SELECT * FROM users WHERE role = $1', ['admin'])
 *
 * // Query builder
 * const admins = await db.table('users').where('role', '=', 'admin').rows()
 *
 * // Transactions
 * await db.transaction(async (tx) => {
 *   await tx.execute('INSERT INTO orders ...', [...])
 *   await tx.execute('UPDATE inventory ...', [...])
 * })
 *
 * // Migrations
 * const migrator = db.getMigrator({ directory: './migrations' })
 * await migrator.up()
 * ```
 */

// ─── Core ────────────────────────────────────────────────────────────────────
export {
  DatabaseManager,
  createDatabase,
  db,
  setDefaultDatabase,
} from './manager'

// ─── Query Builder ───────────────────────────────────────────────────────────
export { QueryBuilder } from './query-builder'

// ─── Migration ───────────────────────────────────────────────────────────────
export { Migrator } from './migration'

// ─── Adapters ────────────────────────────────────────────────────────────────
export { PostgresAdapter } from './adapters/postgres'
export { MysqlAdapter } from './adapters/mysql'
export { SqliteAdapter } from './adapters/sqlite'
export { MongodbAdapter } from './adapters/mongodb'

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  DatabaseDialect,
  DatabaseConfig,
  DatabaseAdapter,
  DatabaseSslConfig,
  PoolConfig,
  QueryResult,
  ExecuteResult,
  Transaction,
  FieldInfo,
  Migration,
  MigrationConfig,
  MigrationRecord,
  WhereOperator,
  OrderDirection,
  JoinType,
} from './types'
