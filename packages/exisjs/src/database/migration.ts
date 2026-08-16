/**
 * Built-in Migration System.
 *
 * Tracks applied migrations in a `_exis_migrations` table and provides
 * up/down/status operations. Migrations are ordered by filename and
 * applied in batches for clean rollbacks.
 *
 * Usage:
 *   const migrator = new Migrator(adapter, { directory: './migrations' })
 *   await migrator.up()       // Apply all pending migrations
 *   await migrator.down()     // Rollback the last batch
 *   await migrator.status()   // Get migration status
 */

import { readdir } from 'node:fs/promises'
import { resolve, extname, basename } from 'node:path'
import type {
  DatabaseAdapter,
  MigrationConfig,
  MigrationRecord,
  Migration,
} from './types'

const DEFAULT_TABLE = '_exis_migrations'

export class Migrator {
  private adapter: DatabaseAdapter
  private config: Required<MigrationConfig>

  constructor(adapter: DatabaseAdapter, config?: MigrationConfig) {
    this.adapter = adapter
    this.config = {
      directory: config?.directory || './migrations',
      tableName: config?.tableName || DEFAULT_TABLE,
    }
  }

  /**
   * Ensure the migrations tracking table exists.
   */
  async ensureTable(): Promise<void> {
    const { tableName } = this.config
    const dialect = this.adapter.dialect

    if (dialect === 'mongodb') {
      // MongoDB doesn't need a schema — we just use a collection
      return
    }

    const createSQL =
      dialect === 'sqlite'
        ? `CREATE TABLE IF NOT EXISTS ${tableName} (
            name TEXT PRIMARY KEY,
            batch INTEGER NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
          )`
        : dialect === 'mysql'
          ? `CREATE TABLE IF NOT EXISTS ${tableName} (
              name VARCHAR(255) PRIMARY KEY,
              batch INT NOT NULL,
              applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`
          : `CREATE TABLE IF NOT EXISTS ${tableName} (
              name VARCHAR(255) PRIMARY KEY,
              batch INT NOT NULL,
              applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )`

    await this.adapter.execute(createSQL)
  }

  /**
   * Apply all pending migrations.
   * @returns The names of the migrations that were applied.
   */
  async up(): Promise<string[]> {
    await this.ensureTable()

    const applied = await this.getApplied()
    const allMigrations = await this.loadMigrations()
    const pending = allMigrations.filter((m) => !applied.has(m.name))

    if (pending.length === 0) {
      return []
    }

    const batch = await this.getNextBatch()
    const appliedNames: string[] = []

    for (const migration of pending) {
      await this.adapter.transaction(async (tx) => {
        // Run the migration
        await migration.up(this.adapter)

        // Record it
        if (this.adapter.dialect === 'mongodb') {
          await this.adapter.execute('_exis_migrations.insertOne', [
            { name: migration.name, batch, applied_at: new Date() },
          ])
        } else {
          const placeholder = this.adapter.dialect === 'postgres' ? '$1' : '?'
          const placeholder2 = this.adapter.dialect === 'postgres' ? '$2' : '?'
          await tx.execute(
            `INSERT INTO ${this.config.tableName} (name, batch) VALUES (${placeholder}, ${placeholder2})`,
            [migration.name, batch]
          )
        }
      })

      appliedNames.push(migration.name)
    }

    return appliedNames
  }

  /**
   * Rollback the last batch of migrations.
   * @returns The names of the migrations that were rolled back.
   */
  async down(): Promise<string[]> {
    await this.ensureTable()

    const lastBatch = await this.getLastBatch()
    if (lastBatch === 0) {
      return []
    }

    const batchMigrations = await this.getMigrationsInBatch(lastBatch)
    const allMigrations = await this.loadMigrations()
    const migrationMap = new Map(allMigrations.map((m) => [m.name, m]))

    const rolledBack: string[] = []

    // Rollback in reverse order
    for (const record of batchMigrations.reverse()) {
      const migration = migrationMap.get(record.name)
      if (!migration) {
        throw new Error(
          `Migration file for '${record.name}' not found. Cannot rollback.`
        )
      }

      await this.adapter.transaction(async (tx) => {
        await migration.down(this.adapter)

        if (this.adapter.dialect === 'mongodb') {
          await this.adapter.execute('_exis_migrations.deleteOne', [
            { name: record.name },
          ])
        } else {
          const placeholder = this.adapter.dialect === 'postgres' ? '$1' : '?'
          await tx.execute(
            `DELETE FROM ${this.config.tableName} WHERE name = ${placeholder}`,
            [record.name]
          )
        }
      })

      rolledBack.push(record.name)
    }

    return rolledBack
  }

  /**
   * Rollback all migrations.
   */
  async reset(): Promise<string[]> {
    const rolledBack: string[] = []
    let batch = await this.getLastBatch()

    while (batch > 0) {
      const names = await this.down()
      rolledBack.push(...names)
      batch = await this.getLastBatch()
    }

    return rolledBack
  }

  /**
   * Get the status of all migrations.
   */
  async status(): Promise<
    { name: string; applied: boolean; batch?: number; appliedAt?: Date }[]
  > {
    await this.ensureTable()

    const applied = await this.getAppliedRecords()
    const allMigrations = await this.loadMigrations()
    const appliedMap = new Map(applied.map((r) => [r.name, r]))

    return allMigrations.map((m) => {
      const record = appliedMap.get(m.name)
      return {
        name: m.name,
        applied: !!record,
        batch: record?.batch,
        appliedAt: record?.appliedAt,
      }
    })
  }

  /**
   * Create a new migration file in the migrations directory.
   */
  async create(name: string): Promise<string> {
    const { mkdir, writeFile } = await import('node:fs/promises')

    const dir = resolve(this.config.directory)
    await mkdir(dir, { recursive: true })

    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 14)
    const filename = `${timestamp}_${name}.ts`
    const filepath = resolve(dir, filename)

    const template = `import type { DatabaseAdapter } from 'exisjs/database'

export default {
  name: '${timestamp}_${name}',

  async up(db: DatabaseAdapter): Promise<void> {
    // Write your migration here
    // await db.execute('CREATE TABLE ...')
  },

  async down(db: DatabaseAdapter): Promise<void> {
    // Write the rollback here
    // await db.execute('DROP TABLE ...')
  },
}
`

    await writeFile(filepath, template, 'utf-8')
    return filepath
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private async loadMigrations(): Promise<Migration[]> {
    const dir = resolve(this.config.directory)

    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      return []
    }

    const migrationFiles = files
      .filter((f) => {
        const ext = extname(f)
        return ext === '.ts' || ext === '.js' || ext === '.mjs'
      })
      .sort()

    const migrations: Migration[] = []

    for (const file of migrationFiles) {
      const filepath = resolve(dir, file)
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(filepath)
        const migration = mod.default || mod
        if (
          migration &&
          typeof migration.up === 'function' &&
          typeof migration.down === 'function'
        ) {
          migrations.push({
            name: migration.name || basename(file, extname(file)),
            up: migration.up,
            down: migration.down,
          })
        }
      } catch (err: any) {
        throw new Error(`Failed to load migration '${file}': ${err.message}`, {
          cause: err,
        })
      }
    }

    return migrations
  }

  private async getApplied(): Promise<Set<string>> {
    const records = await this.getAppliedRecords()
    return new Set(records.map((r) => r.name))
  }

  private async getAppliedRecords(): Promise<MigrationRecord[]> {
    if (this.adapter.dialect === 'mongodb') {
      const result = await this.adapter.query<any>('_exis_migrations', [{}])
      return result.rows.map((r: any) => ({
        name: r.name,
        batch: r.batch,
        appliedAt: new Date(r.applied_at),
      }))
    }

    try {
      const result = await this.adapter.query<any>(
        `SELECT name, batch, applied_at FROM ${this.config.tableName} ORDER BY name`
      )
      return result.rows.map((r: any) => ({
        name: r.name,
        batch: r.batch,
        appliedAt: new Date(r.applied_at),
      }))
    } catch {
      return []
    }
  }

  private async getNextBatch(): Promise<number> {
    return (await this.getLastBatch()) + 1
  }

  private async getLastBatch(): Promise<number> {
    if (this.adapter.dialect === 'mongodb') {
      const result = await this.adapter.query<any>('_exis_migrations', [
        {},
        { sort: { batch: -1 }, limit: 1 },
      ])
      return result.rows[0]?.batch ?? 0
    }

    try {
      const result = await this.adapter.query<{ max_batch: number | null }>(
        `SELECT MAX(batch) as max_batch FROM ${this.config.tableName}`
      )
      return result.rows[0]?.max_batch ?? 0
    } catch {
      return 0
    }
  }

  private async getMigrationsInBatch(
    batch: number
  ): Promise<MigrationRecord[]> {
    if (this.adapter.dialect === 'mongodb') {
      const result = await this.adapter.query<any>('_exis_migrations', [
        { batch },
      ])
      return result.rows.map((r: any) => ({
        name: r.name,
        batch: r.batch,
        appliedAt: new Date(r.applied_at),
      }))
    }

    const placeholder = this.adapter.dialect === 'postgres' ? '$1' : '?'
    const result = await this.adapter.query<any>(
      `SELECT name, batch, applied_at FROM ${this.config.tableName} WHERE batch = ${placeholder} ORDER BY name`,
      [batch]
    )

    return result.rows.map((r: any) => ({
      name: r.name,
      batch: r.batch,
      appliedAt: new Date(r.applied_at),
    }))
  }
}
