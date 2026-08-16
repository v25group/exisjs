import { describe, it, expect, before, after } from '../src/testing'
import { DatabaseManager, createDatabase } from '../src/database/manager'
import { QueryBuilder } from '../src/database/query-builder'
import { Migrator } from '../src/database/migration'
import { SqliteAdapter } from '../src/database/adapters/sqlite'
import { createTempDir, cleanupTempDir, writeTempFile } from './helpers'
import type { DatabaseAdapter, DatabaseConfig } from '../src/database/types'

// ─── SQLite-based integration tests ─────────────────────────────────────────
// SQLite is the only adapter that requires zero external services,
// so it's the ideal candidate for CI-safe automated testing.
// Other adapters (Postgres, MySQL, MongoDB) follow the same interface.

describe('Database Layer', () => {
  let adapter: SqliteAdapter
  let manager: DatabaseManager

  before(async () => {
    adapter = new SqliteAdapter({
      dialect: 'sqlite',
      filename: ':memory:',
    })
    await adapter.connect()

    // Create a test table
    await adapter.execute(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'user',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `)

    await adapter.execute(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `)
  })

  after(async () => {
    await adapter.disconnect()
  })

  // ─── Adapter Core ────────────────────────────────────────────────────────

  describe('SQLite Adapter', () => {
    it('connects and reports healthy', async () => {
      const healthy = await adapter.isHealthy()
      expect(healthy).toBe(true)
    })

    it('returns the raw client via getRawClient()', () => {
      const raw = adapter.getRawClient()
      expect(raw).not.toBe(null)
    })

    it('has dialect set to sqlite', () => {
      expect(adapter.dialect).toBe('sqlite')
    })

    it('executes INSERT and returns affectedRows + insertId', async () => {
      const result = await adapter.execute(
        `INSERT INTO users (name, email, role) VALUES (?, ?, ?)`,
        ['Alice', 'alice@example.com', 'admin']
      )

      expect(result.affectedRows).toBe(1)
      expect(result.insertId).toBeDefined()
    })

    it('executes SELECT and returns typed rows', async () => {
      const result = await adapter.query<{
        id: number
        name: string
        email: string
      }>(`SELECT id, name, email FROM users WHERE email = ?`, [
        'alice@example.com',
      ])

      expect(result.rowCount).toBe(1)
      expect(result.rows[0].name).toBe('Alice')
      expect(result.rows[0].email).toBe('alice@example.com')
    })

    it('executes UPDATE and returns affectedRows', async () => {
      const result = await adapter.execute(
        `UPDATE users SET role = ? WHERE email = ?`,
        ['superadmin', 'alice@example.com']
      )

      expect(result.affectedRows).toBe(1)

      const verify = await adapter.query<{ role: string }>(
        `SELECT role FROM users WHERE email = ?`,
        ['alice@example.com']
      )
      expect(verify.rows[0].role).toBe('superadmin')
    })

    it('returns empty result set for no matches', async () => {
      const result = await adapter.query(
        `SELECT * FROM users WHERE email = ?`,
        ['nonexistent@example.com']
      )

      expect(result.rowCount).toBe(0)
      expect(result.rows).toEqual([])
    })

    it('batch inserts multiple rows', async () => {
      await adapter.execute(
        `INSERT INTO users (name, email) VALUES (?, ?), (?, ?)`,
        ['Bob', 'bob@example.com', 'Charlie', 'charlie@example.com']
      )

      const result = await adapter.query<{ name: string }>(
        `SELECT name FROM users ORDER BY id`
      )

      expect(result.rowCount).toBeGreaterThanOrEqual(3)
    })
  })

  // ─── Transactions ──────────────────────────────────────────────────────────

  describe('Transactions', () => {
    it('commits a successful transaction', async () => {
      await adapter.transaction(async (tx) => {
        await tx.execute(`INSERT INTO users (name, email) VALUES (?, ?)`, [
          'TxUser',
          'txuser@example.com',
        ])
      })

      const result = await adapter.query<{ name: string }>(
        `SELECT name FROM users WHERE email = ?`,
        ['txuser@example.com']
      )
      expect(result.rowCount).toBe(1)
      expect(result.rows[0].name).toBe('TxUser')
    })

    it('rolls back a failed transaction', async () => {
      try {
        await adapter.transaction(async (tx) => {
          await tx.execute(`INSERT INTO users (name, email) VALUES (?, ?)`, [
            'RollbackUser',
            'rollback@example.com',
          ])
          throw new Error('Simulated failure')
        })
      } catch (err: any) {
        expect(err.message).toBe('Simulated failure')
      }

      const result = await adapter.query(
        `SELECT * FROM users WHERE email = ?`,
        ['rollback@example.com']
      )
      expect(result.rowCount).toBe(0)
    })

    it('supports savepoints within a transaction', async () => {
      await adapter.transaction(async (tx) => {
        await tx.execute(`INSERT INTO users (name, email) VALUES (?, ?)`, [
          'SavepointUser',
          'savepoint@example.com',
        ])

        await tx.savepoint('sp1')

        await tx.execute(`INSERT INTO users (name, email) VALUES (?, ?)`, [
          'SavepointUser2',
          'savepoint2@example.com',
        ])

        // Rollback to savepoint — SavepointUser2 should not exist
        await tx.rollbackTo('sp1')
      })

      const result1 = await adapter.query(
        `SELECT * FROM users WHERE email = ?`,
        ['savepoint@example.com']
      )
      expect(result1.rowCount).toBe(1)

      const result2 = await adapter.query(
        `SELECT * FROM users WHERE email = ?`,
        ['savepoint2@example.com']
      )
      expect(result2.rowCount).toBe(0)
    })
  })

  // ─── Query Builder ─────────────────────────────────────────────────────────

  describe('Query Builder', () => {
    it('generates correct SELECT SQL', () => {
      const qb = new QueryBuilder(adapter, 'users')
      const { sql, params } = qb
        .select('id', 'name', 'email')
        .where('role', '=', 'admin')
        .orderBy('name', 'ASC')
        .limit(10)
        .toSQL()

      expect(sql).toContain('SELECT id, name, email FROM users')
      expect(sql).toContain('WHERE')
      expect(sql).toContain('role = ?')
      expect(sql).toContain('ORDER BY name ASC')
      expect(sql).toContain('LIMIT ?')
      expect(params).toContain('admin')
      expect(params).toContain(10)
    })

    it('generates correct INSERT SQL', () => {
      const qb = new QueryBuilder(adapter, 'users')
      const { sql, params } = qb
        .insert({ name: 'Test', email: 'test@example.com', role: 'user' })
        .toSQL()

      expect(sql).toContain('INSERT INTO users')
      expect(sql).toContain('name')
      expect(sql).toContain('VALUES')
      expect(params).toContain('Test')
      expect(params).toContain('test@example.com')
    })

    it('generates correct UPDATE SQL', () => {
      const qb = new QueryBuilder(adapter, 'users')
      const { sql, params } = qb
        .where('id', '=', 1)
        .update({ name: 'Updated', role: 'superadmin' })
        .toSQL()

      expect(sql).toContain('UPDATE users SET')
      expect(sql).toContain('name = ?')
      expect(sql).toContain('role = ?')
      expect(sql).toContain('WHERE')
      expect(params).toContain('Updated')
    })

    it('generates correct DELETE SQL', () => {
      const qb = new QueryBuilder(adapter, 'users')
      const { sql, params } = qb.where('id', '=', 99).delete().toSQL()

      expect(sql).toContain('DELETE FROM users')
      expect(sql).toContain('WHERE')
      expect(params).toContain(99)
    })

    it('supports WHERE IN clauses', () => {
      const qb = new QueryBuilder(adapter, 'users')
      const { sql, params } = qb
        .whereIn('role', ['admin', 'superadmin', 'moderator'])
        .toSQL()

      expect(sql).toContain('IN (?, ?, ?)')
      expect(params).toContain('admin')
      expect(params).toContain('superadmin')
      expect(params).toContain('moderator')
    })

    it('supports WHERE NULL / NOT NULL', () => {
      const qb1 = new QueryBuilder(adapter, 'users')
      const { sql: sql1 } = qb1.whereNull('email').toSQL()
      expect(sql1).toContain('email IS NULL')

      const qb2 = new QueryBuilder(adapter, 'users')
      const { sql: sql2 } = qb2.whereNotNull('email').toSQL()
      expect(sql2).toContain('email IS NOT NULL')
    })

    it('supports BETWEEN clauses', () => {
      const qb = new QueryBuilder(adapter, 'users')
      const { sql, params } = qb.whereBetween('id', 1, 100).toSQL()

      expect(sql).toContain('BETWEEN ? AND ?')
      expect(params).toContain(1)
      expect(params).toContain(100)
    })

    it('supports JOIN clauses', () => {
      const qb = new QueryBuilder(adapter, 'users')
      const { sql } = qb
        .select('users.name', 'posts.title')
        .join('posts', 'posts.user_id = users.id')
        .toSQL()

      expect(sql).toContain('INNER JOIN posts ON posts.user_id = users.id')
    })

    it('supports LEFT JOIN', () => {
      const qb = new QueryBuilder(adapter, 'users')
      const { sql } = qb
        .select('users.name', 'posts.title')
        .leftJoin('posts', 'posts.user_id = users.id')
        .toSQL()

      expect(sql).toContain('LEFT JOIN posts ON posts.user_id = users.id')
    })

    it('supports GROUP BY and HAVING', () => {
      const qb = new QueryBuilder(adapter, 'users')
      const { sql, params } = qb
        .select('role', 'COUNT(*) as count')
        .groupBy('role')
        .having('COUNT(*)', '>', 1)
        .toSQL()

      expect(sql).toContain('GROUP BY role')
      expect(sql).toContain('HAVING')
      expect(params).toContain(1)
    })

    it('supports DISTINCT', () => {
      const qb = new QueryBuilder(adapter, 'users')
      const { sql } = qb.select('role').distinct().toSQL()

      expect(sql).toContain('SELECT DISTINCT role')
    })

    it('supports OR WHERE', () => {
      const qb = new QueryBuilder(adapter, 'users')
      const { sql, params } = qb
        .where('role', '=', 'admin')
        .orWhere('role', '=', 'superadmin')
        .toSQL()

      expect(sql).toContain('WHERE role = ?')
      expect(sql).toContain('OR role = ?')
      expect(params).toContain('admin')
      expect(params).toContain('superadmin')
    })

    // ── Live execution tests ──

    it('executes a real SELECT via .rows()', async () => {
      const rows = await new QueryBuilder<{ name: string }>(adapter, 'users')
        .select('name')
        .where('email', '=', 'alice@example.com')
        .rows()

      expect(rows.length).toBeGreaterThanOrEqual(1)
      expect(rows[0].name).toBe('Alice')
    })

    it('executes a real SELECT via .first()', async () => {
      const user = await new QueryBuilder<{ name: string; email: string }>(
        adapter,
        'users'
      )
        .select('name', 'email')
        .where('email', '=', 'alice@example.com')
        .first()

      expect(user).not.toBe(null)
      expect(user!.name).toBe('Alice')
    })

    it('returns null from .first() when no match', async () => {
      const user = await new QueryBuilder(adapter, 'users')
        .where('email', '=', 'nonexistent@example.com')
        .first()

      expect(user).toBe(null)
    })

    it('executes .count()', async () => {
      const count = await new QueryBuilder(adapter, 'users').count()

      expect(count).toBeGreaterThanOrEqual(1)
    })

    it('executes a real INSERT via .execute()', async () => {
      const result = await new QueryBuilder(adapter, 'users')
        .insert({ name: 'QBUser', email: 'qbuser@example.com', role: 'user' })
        .execute()

      expect('affectedRows' in result).toBe(true)

      const verify = await adapter.query<{ name: string }>(
        `SELECT name FROM users WHERE email = ?`,
        ['qbuser@example.com']
      )
      expect(verify.rows[0].name).toBe('QBUser')
    })

    it('executes a real UPDATE via .execute()', async () => {
      await new QueryBuilder(adapter, 'users')
        .where('email', '=', 'qbuser@example.com')
        .update({ role: 'admin' })
        .execute()

      const verify = await adapter.query<{ role: string }>(
        `SELECT role FROM users WHERE email = ?`,
        ['qbuser@example.com']
      )
      expect(verify.rows[0].role).toBe('admin')
    })

    it('executes a real DELETE via .execute()', async () => {
      await new QueryBuilder(adapter, 'users')
        .where('email', '=', 'qbuser@example.com')
        .delete()
        .execute()

      const verify = await adapter.query(
        `SELECT * FROM users WHERE email = ?`,
        ['qbuser@example.com']
      )
      expect(verify.rowCount).toBe(0)
    })
  })

  // ─── Database Manager ──────────────────────────────────────────────────────

  describe('DatabaseManager', () => {
    let mgr: DatabaseManager

    before(async () => {
      mgr = new DatabaseManager()
      mgr.addConnection({ dialect: 'sqlite', filename: ':memory:' })
      await mgr.connect()

      await mgr.execute(`
        CREATE TABLE items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          price REAL NOT NULL
        )
      `)
    })

    after(async () => {
      await mgr.disconnect()
    })

    it('connects and reports healthy', async () => {
      const healthy = await mgr.isHealthy()
      expect(healthy).toBe(true)
    })

    it('executes raw queries via manager', async () => {
      await mgr.execute(`INSERT INTO items (name, price) VALUES (?, ?)`, [
        'Widget',
        9.99,
      ])

      const result = await mgr.query<{ name: string; price: number }>(
        `SELECT name, price FROM items WHERE name = ?`,
        ['Widget']
      )

      expect(result.rowCount).toBe(1)
      expect(result.rows[0].name).toBe('Widget')
      expect(result.rows[0].price).toBe(9.99)
    })

    it('uses .table() for query builder access', async () => {
      const items = await mgr
        .table<{ name: string }>('items')
        .select('name')
        .rows()

      expect(items.length).toBeGreaterThanOrEqual(1)
    })

    it('executes transactions via manager', async () => {
      await mgr.transaction(async (tx) => {
        await tx.execute(`INSERT INTO items (name, price) VALUES (?, ?)`, [
          'TxItem',
          19.99,
        ])
      })

      const result = await mgr.query<{ name: string }>(
        `SELECT name FROM items WHERE name = ?`,
        ['TxItem']
      )
      expect(result.rowCount).toBe(1)
    })

    it('healthCheck returns status for all connections', async () => {
      const status = await mgr.healthCheck()
      expect(status['default']).toBe(true)
    })

    it('getDialect returns the correct dialect', () => {
      expect(mgr.getDialect()).toBe('sqlite')
    })

    it('getRawClient returns the underlying client', () => {
      const raw = mgr.getRawClient()
      expect(raw).not.toBe(null)
    })
  })

  // ─── createDatabase Factory ────────────────────────────────────────────────

  describe('createDatabase Factory', () => {
    it('creates and connects a database in one step', async () => {
      const testDb = createDatabase({
        dialect: 'sqlite',
        filename: ':memory:',
      })

      await testDb.connect()
      const healthy = await testDb.isHealthy()
      expect(healthy).toBe(true)

      await testDb.execute(
        `CREATE TABLE test_factory (id INTEGER PRIMARY KEY, val TEXT)`
      )
      await testDb.execute(`INSERT INTO test_factory (val) VALUES (?)`, [
        'hello',
      ])

      const result = await testDb.query<{ val: string }>(
        `SELECT val FROM test_factory`
      )
      expect(result.rows[0].val).toBe('hello')

      await testDb.disconnect()
    })
  })

  // ─── Migration System ──────────────────────────────────────────────────────

  describe('Migrator', () => {
    let migDb: SqliteAdapter
    let migrator: Migrator
    let tempDir: string

    before(async () => {
      migDb = new SqliteAdapter({ dialect: 'sqlite', filename: ':memory:' })
      await migDb.connect()

      tempDir = createTempDir('exis-migration-test-')

      // Create migration files
      writeTempFile(
        tempDir,
        '001_create_accounts.ts',
        `
        module.exports = {
          name: '001_create_accounts',
          async up(db) {
            await db.execute(\`CREATE TABLE accounts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              username TEXT NOT NULL UNIQUE
            )\`)
          },
          async down(db) {
            await db.execute('DROP TABLE IF EXISTS accounts')
          },
        }
      `
      )

      writeTempFile(
        tempDir,
        '002_add_email_column.ts',
        `
        module.exports = {
          name: '002_add_email_column',
          async up(db) {
            await db.execute('ALTER TABLE accounts ADD COLUMN email TEXT')
          },
          async down(db) {
            // SQLite doesn't support DROP COLUMN, so recreate
            await db.execute('CREATE TABLE accounts_backup AS SELECT id, username FROM accounts')
            await db.execute('DROP TABLE accounts')
            await db.execute('ALTER TABLE accounts_backup RENAME TO accounts')
          },
        }
      `
      )

      migrator = new Migrator(migDb, { directory: tempDir })
    })

    after(async () => {
      await migDb.disconnect()
      cleanupTempDir(tempDir)
    })

    it('runs all pending migrations with up()', async () => {
      const applied = await migrator.up()

      expect(applied.length).toBe(2)
      expect(applied[0]).toBe('001_create_accounts')
      expect(applied[1]).toBe('002_add_email_column')
    })

    it('returns empty array when no pending migrations', async () => {
      const applied = await migrator.up()
      expect(applied.length).toBe(0)
    })

    it('shows correct status after applying migrations', async () => {
      const status = await migrator.status()

      expect(status.length).toBe(2)
      expect(status[0].applied).toBe(true)
      expect(status[1].applied).toBe(true)
      expect(status[0].batch).toBe(1)
    })

    it('the applied migrations actually created the table', async () => {
      const result = await migDb.execute(
        `INSERT INTO accounts (username, email) VALUES (?, ?)`,
        ['testuser', 'test@example.com']
      )
      expect(result.affectedRows).toBe(1)
    })

    it('rolls back the last batch with down()', async () => {
      const rolledBack = await migrator.down()

      expect(rolledBack.length).toBe(2)
    })

    it('re-applies migrations after rollback', async () => {
      const applied = await migrator.up()
      expect(applied.length).toBe(2)
    })

    it('resets all migrations', async () => {
      const rolledBack = await migrator.reset()
      expect(rolledBack.length).toBe(2)

      const status = await migrator.status()
      expect(status.every((s) => !s.applied)).toBe(true)
    })
  })

  // ─── Health Check ──────────────────────────────────────────────────────────

  describe('Health Check', () => {
    it('returns false for disconnected adapter', async () => {
      const disconnected = new SqliteAdapter({
        dialect: 'sqlite',
        filename: ':memory:',
      })

      const healthy = await disconnected.isHealthy()
      expect(healthy).toBe(false)
    })
  })

  // ─── Error Handling ────────────────────────────────────────────────────────

  describe('Error Handling', () => {
    it('throws on query when not connected', async () => {
      const disconnected = new SqliteAdapter({
        dialect: 'sqlite',
        filename: ':memory:',
      })

      let threw = false
      try {
        await disconnected.query('SELECT 1')
      } catch (err: any) {
        threw = true
        expect(err.message).toContain('not connected')
      }
      expect(threw).toBe(true)
    })

    it('throws on invalid SQL', async () => {
      let threw = false
      try {
        await adapter.query('SELECT * FROM nonexistent_table_xyz')
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
    })

    it('DatabaseManager throws when connection not found', () => {
      const mgr = new DatabaseManager()
      let threw = false
      try {
        mgr.getAdapter('nonexistent')
      } catch (err: any) {
        threw = true
        expect(err.message).toContain('not found')
      }
      expect(threw).toBe(true)
    })
  })
})
