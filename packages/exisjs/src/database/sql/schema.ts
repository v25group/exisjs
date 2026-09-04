export type ColumnType =
  | 'text'
  | 'varchar'
  | 'uuid'
  | 'integer'
  | 'serial'
  | 'bigint'
  | 'boolean'
  | 'timestamptz'
  | 'timestamp'
  | 'date'
  | 'jsonb'
  | 'json'
  | 'numeric'
  | 'real'
  | 'double precision'

export class ColumnBuilder {
  public name: string
  public dataType: ColumnType
  public isPrimaryKey = false
  public isUnique = false
  public isNotNull = false
  public defaultValue?: string
  public reference?: () => ColumnBuilder
  public tableName?: string

  constructor(name: string, type: ColumnType) {
    this.name = name
    this.dataType = type
  }

  primaryKey(): this {
    this.isPrimaryKey = true
    return this
  }

  unique(): this {
    this.isUnique = true
    return this
  }

  notNull(): this {
    this.isNotNull = true
    return this
  }

  default(val: string): this {
    this.defaultValue = val
    return this
  }

  references(ref: () => ColumnBuilder): this {
    this.reference = ref
    return this
  }
}

// ─── Column Helpers ──────────────────────────────────────────────────────────

export const text = (name: string) => new ColumnBuilder(name, 'text')
export const varchar = (name: string) => new ColumnBuilder(name, 'varchar')
export const uuid = (name: string) => new ColumnBuilder(name, 'uuid')
export const integer = (name: string) => new ColumnBuilder(name, 'integer')
export const serial = (name: string) => new ColumnBuilder(name, 'serial')
export const bigint = (name: string) => new ColumnBuilder(name, 'bigint')
export const boolean = (name: string) => new ColumnBuilder(name, 'boolean')
export const timestamptz = (name: string) =>
  new ColumnBuilder(name, 'timestamptz')
export const timestamp = (name: string) => new ColumnBuilder(name, 'timestamp')
export const date = (name: string) => new ColumnBuilder(name, 'date')
export const jsonb = (name: string) => new ColumnBuilder(name, 'jsonb')
export const json = (name: string) => new ColumnBuilder(name, 'json')
export const numeric = (name: string) => new ColumnBuilder(name, 'numeric')
export const real = (name: string) => new ColumnBuilder(name, 'real')

// ─── Table Builder ───────────────────────────────────────────────────────────

export class TableDefinition {
  public tableName: string
  public columns: Record<string, ColumnBuilder>

  constructor(name: string, columns: Record<string, ColumnBuilder>) {
    this.tableName = name
    this.columns = columns
  }
}

export function table<T extends Record<string, ColumnBuilder>>(
  name: string,
  columns: T
): TableDefinition & T {
  const t = new TableDefinition(name, columns)
  for (const col of Object.values(columns)) {
    col.tableName = name
  }
  // Merge columns into the table object for easy access: table.columnName
  return Object.assign(t, columns)
}
