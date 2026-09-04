import type { DatabaseAdapter } from './types'
import type { TableDefinition, ColumnBuilder } from './sql/schema'

export class SchemaSynchronizer {
  constructor(private adapter: DatabaseAdapter) {}

  async sync(tables: TableDefinition[]): Promise<void> {
    if (this.adapter.dialect !== 'postgres') {
      console.warn(
        `[ExisJS Auto-Sync] Sync is currently optimized for postgres. Skipping.`
      )
      return
    }

    for (const table of tables) {
      await this.syncTable(table)
    }
  }

  private async syncTable(table: TableDefinition): Promise<void> {
    const tableName = table.tableName

    // Check if table exists
    const res = await this.adapter.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables 
         WHERE table_schema = 'public' 
         AND table_name = $1
       )`,
      [tableName]
    )

    const exists = res.rows[0]?.exists

    if (!exists) {
      // Create table
      const ddl = this.buildCreateTable(table)
      await this.adapter.execute(ddl)
      console.log(`[ExisJS Database] Created table "${tableName}"`)
    } else {
      // Sync columns
      await this.syncColumns(table)
    }
  }

  private async syncColumns(table: TableDefinition): Promise<void> {
    const tableName = table.tableName

    const res = await this.adapter.query<{ column_name: string }>(
      `SELECT column_name 
       FROM information_schema.columns 
       WHERE table_schema = 'public' 
       AND table_name = $1`,
      [tableName]
    )

    const existingCols = new Set(res.rows.map((r) => r.column_name))

    for (const [colName, colDef] of Object.entries(table.columns)) {
      if (!existingCols.has(colName)) {
        const ddl = `ALTER TABLE "${tableName}" ADD COLUMN ${this.buildColumnDefinition(colDef)}`
        await this.adapter.execute(ddl)
        console.log(
          `[ExisJS Database] Added column "${colName}" to "${tableName}"`
        )
      }
    }
  }

  private buildCreateTable(table: TableDefinition): string {
    const columns = Object.values(table.columns).map((col) =>
      this.buildColumnDefinition(col)
    )
    return `CREATE TABLE "${table.tableName}" (\n  ${columns.join(',\n  ')}\n)`
  }

  private buildColumnDefinition(col: ColumnBuilder): string {
    let def = `"${col.name}" ${col.dataType.toUpperCase()}`

    if (col.isPrimaryKey) {
      def += ' PRIMARY KEY'
    }

    if (col.isUnique && !col.isPrimaryKey) {
      def += ' UNIQUE'
    }

    if (col.isNotNull && !col.isPrimaryKey) {
      def += ' NOT NULL'
    }

    if (col.defaultValue) {
      // If the default is a function like gen_random_uuid(), we don't wrap it in quotes.
      // If it's a raw string 'NOW()', we just use it directly (as they provided it).
      def += ` DEFAULT ${col.defaultValue}`
    }

    if (col.reference) {
      const refCol = col.reference()
      if (refCol.tableName) {
        def += ` REFERENCES "${refCol.tableName}"("${refCol.name}")`
      }
    }

    return def
  }
}
