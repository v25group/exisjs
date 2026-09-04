/**
 * Chainable SQL Query Builder.
 *
 * Generates dialect-specific SQL with parameterized queries.
 * Supports select, insert, update, delete, joins, where, orderBy, limit, offset,
 * groupBy, and having.
 *
 * Uses PostgreSQL-style $1, $2 placeholders by default.
 * MySQL mode uses ? placeholders.
 */

import type {
  DatabaseAdapter,
  DatabaseDialect,
  WhereOperator,
  OrderDirection,
  JoinType,
  WhereClause,
  JoinClause,
  OrderByClause,
  QueryResult,
  ExecuteResult,
} from './types'

export class QueryBuilder<T = Record<string, unknown>> {
  private adapter: DatabaseAdapter
  private dialect: DatabaseDialect
  private tableName: string
  private operation: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private selectColumns: string[] = ['*']
  private whereClauses: WhereClause[] = []
  private joinClauses: JoinClause[] = []
  private orderByClauses: OrderByClause[] = []
  private groupByColumns: string[] = []
  private havingClauses: WhereClause[] = []
  private limitValue?: number
  private offsetValue?: number
  private insertData?: Record<string, unknown> | Record<string, unknown>[]
  private updateData?: Record<string, unknown>
  private returningColumns?: string[]
  private distinctFlag = false
  private params: unknown[] = []

  constructor(adapter: DatabaseAdapter, table: string) {
    this.adapter = adapter
    this.dialect = adapter.dialect
    this.tableName = table
  }

  // ─── SELECT ────────────────────────────────────────────────────────────────

  select(...columns: string[]): this {
    this.operation = 'select'
    if (columns.length > 0) {
      this.selectColumns = columns
    }
    return this
  }

  distinct(): this {
    this.distinctFlag = true
    return this
  }

  // ─── SQL-First API Extensions ──────────────────────────────────────────────

  setOperation(op: 'select' | 'insert' | 'update' | 'delete'): this {
    this.operation = op
    return this
  }

  from(tableDef: any): this {
    this.tableName =
      typeof tableDef === 'string' ? tableDef : tableDef.tableName
    return this
  }

  values(data: Record<string, unknown> | Record<string, unknown>[]): this {
    this.insertData = data
    return this
  }

  set(data: Record<string, unknown>): this {
    this.updateData = data
    return this
  }

  // ─── WHERE ─────────────────────────────────────────────────────────────────

  where(condition: any): this
  where(column: string, operator: WhereOperator, value: unknown): this
  where(
    columnOrCondition: string | any,
    operator?: WhereOperator,
    value?: unknown
  ): this {
    if (
      typeof columnOrCondition === 'object' &&
      'column' in columnOrCondition
    ) {
      const cond = columnOrCondition
      const colName =
        typeof cond.column === 'string' ? cond.column : cond.column.name
      this.whereClauses.push({
        column: colName,
        operator: cond.operator,
        value: cond.value,
        conjunction: 'AND',
      })
      return this
    }

    this.whereClauses.push({
      column: columnOrCondition as string,
      operator: operator as WhereOperator,
      value,
      conjunction: 'AND',
    })
    return this
  }

  orWhere(condition: any): this
  orWhere(column: string, operator: WhereOperator, value: unknown): this
  orWhere(
    columnOrCondition: string | any,
    operator?: WhereOperator,
    value?: unknown
  ): this {
    if (
      typeof columnOrCondition === 'object' &&
      'column' in columnOrCondition
    ) {
      const cond = columnOrCondition
      const colName =
        typeof cond.column === 'string' ? cond.column : cond.column.name
      this.whereClauses.push({
        column: colName,
        operator: cond.operator,
        value: cond.value,
        conjunction: 'OR',
      })
      return this
    }

    this.whereClauses.push({
      column: columnOrCondition as string,
      operator: operator as WhereOperator,
      value,
      conjunction: 'OR',
    })
    return this
  }

  whereNull(column: string): this {
    this.whereClauses.push({
      column,
      operator: 'IS',
      value: null,
      conjunction: 'AND',
    })
    return this
  }

  whereNotNull(column: string): this {
    this.whereClauses.push({
      column,
      operator: 'IS NOT',
      value: null,
      conjunction: 'AND',
    })
    return this
  }

  whereIn(column: string, values: unknown[]): this {
    this.whereClauses.push({
      column,
      operator: 'IN',
      value: values,
      conjunction: 'AND',
    })
    return this
  }

  whereBetween(column: string, min: unknown, max: unknown): this {
    this.whereClauses.push({
      column,
      operator: 'BETWEEN',
      value: [min, max],
      conjunction: 'AND',
    })
    return this
  }

  // ─── JOIN ──────────────────────────────────────────────────────────────────

  join(table: string, on: string, type: JoinType = 'INNER'): this {
    this.joinClauses.push({ type, table, on })
    return this
  }

  leftJoin(table: string, on: string): this {
    return this.join(table, on, 'LEFT')
  }

  rightJoin(table: string, on: string): this {
    return this.join(table, on, 'RIGHT')
  }

  fullJoin(table: string, on: string): this {
    return this.join(table, on, 'FULL')
  }

  // ─── ORDER / GROUP / LIMIT ─────────────────────────────────────────────────

  orderBy(column: string, direction: OrderDirection = 'ASC'): this {
    this.orderByClauses.push({ column, direction })
    return this
  }

  groupBy(...columns: string[]): this {
    this.groupByColumns.push(...columns)
    return this
  }

  having(column: string, operator: WhereOperator, value: unknown): this {
    this.havingClauses.push({ column, operator, value, conjunction: 'AND' })
    return this
  }

  limit(count: number): this {
    this.limitValue = count
    return this
  }

  offset(count: number): this {
    this.offsetValue = count
    return this
  }

  // ─── INSERT ────────────────────────────────────────────────────────────────

  insert(data: Record<string, unknown> | Record<string, unknown>[]): this {
    this.operation = 'insert'
    this.insertData = data
    return this
  }

  // ─── UPDATE ────────────────────────────────────────────────────────────────

  update(data: Record<string, unknown>): this {
    this.operation = 'update'
    this.updateData = data
    return this
  }

  // ─── DELETE ────────────────────────────────────────────────────────────────

  delete(): this {
    this.operation = 'delete'
    return this
  }

  // ─── RETURNING ─────────────────────────────────────────────────────────────

  returning(...columns: string[]): this {
    this.returningColumns = columns.length > 0 ? columns : ['*']
    return this
  }

  // ─── EXECUTE ───────────────────────────────────────────────────────────────

  async execute(): Promise<QueryResult<T> | ExecuteResult> {
    const { sql, params } = this.toSQL()

    if (this.operation === 'select') {
      return this.adapter.query<T>(sql, params)
    }

    // For insert/update/delete with RETURNING, use query instead of execute
    if (this.returningColumns && this.dialect === 'postgres') {
      return this.adapter.query<T>(sql, params)
    }

    return this.adapter.execute(sql, params)
  }

  /**
   * Execute and return just the rows (convenience method for SELECT).
   */
  async rows(): Promise<T[]> {
    const result = await this.execute()
    return 'rows' in result ? result.rows : []
  }

  /**
   * Execute and return the first row (convenience method for SELECT ... LIMIT 1).
   */
  async first(): Promise<T | null> {
    this.limitValue = 1
    const result = await this.execute()
    return 'rows' in result ? (result.rows[0] ?? null) : null
  }

  /**
   * Execute and return the count of matching rows.
   */
  async count(column = '*'): Promise<number> {
    this.selectColumns = [`COUNT(${column}) as count`]
    const result = await this.adapter.query<{ count: number | string }>(
      this.buildSelect(),
      this.params
    )
    return Number(result.rows[0]?.count ?? 0)
  }

  // ─── SQL Generation ────────────────────────────────────────────────────────

  /**
   * Build the SQL string and parameters without executing.
   */
  toSQL(): { sql: string; params: unknown[] } {
    this.params = []

    let sql: string

    switch (this.operation) {
      case 'select':
        sql = this.buildSelect()
        break
      case 'insert':
        sql = this.buildInsert()
        break
      case 'update':
        sql = this.buildUpdate()
        break
      case 'delete':
        sql = this.buildDelete()
        break
      default:
        throw new Error(`Unknown operation: ${this.operation}`)
    }

    return { sql, params: this.params }
  }

  // ─── Private Builders ──────────────────────────────────────────────────────

  private buildSelect(): string {
    const distinct = this.distinctFlag ? 'DISTINCT ' : ''
    let sql = `SELECT ${distinct}${this.selectColumns.join(', ')} FROM ${this.tableName}`

    sql += this.buildJoins()
    sql += this.buildWhere()
    sql += this.buildGroupBy()
    sql += this.buildHaving()
    sql += this.buildOrderBy()
    sql += this.buildLimit()

    return sql
  }

  private buildInsert(): string {
    if (!this.insertData) {
      throw new Error('No data provided for INSERT')
    }

    const rows = Array.isArray(this.insertData)
      ? this.insertData
      : [this.insertData]
    if (rows.length === 0) {
      throw new Error('No data provided for INSERT')
    }

    const columns = Object.keys(rows[0])
    const valueSets: string[] = []

    for (const row of rows) {
      const placeholders: string[] = []
      for (const col of columns) {
        this.params.push(row[col])
        placeholders.push(this.placeholder())
      }
      valueSets.push(`(${placeholders.join(', ')})`)
    }

    let sql = `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES ${valueSets.join(', ')}`

    if (this.returningColumns && this.dialect === 'postgres') {
      sql += ` RETURNING ${this.returningColumns.join(', ')}`
    }

    return sql
  }

  private buildUpdate(): string {
    if (!this.updateData) {
      throw new Error('No data provided for UPDATE')
    }

    const setClauses: string[] = []
    for (const [key, value] of Object.entries(this.updateData)) {
      this.params.push(value)
      setClauses.push(`${key} = ${this.placeholder()}`)
    }

    let sql = `UPDATE ${this.tableName} SET ${setClauses.join(', ')}`
    sql += this.buildWhere()

    if (this.returningColumns && this.dialect === 'postgres') {
      sql += ` RETURNING ${this.returningColumns.join(', ')}`
    }

    return sql
  }

  private buildDelete(): string {
    let sql = `DELETE FROM ${this.tableName}`
    sql += this.buildWhere()

    if (this.returningColumns && this.dialect === 'postgres') {
      sql += ` RETURNING ${this.returningColumns.join(', ')}`
    }

    return sql
  }

  private buildJoins(): string {
    if (this.joinClauses.length === 0) return ''
    return this.joinClauses
      .map((j) => ` ${j.type} JOIN ${j.table} ON ${j.on}`)
      .join('')
  }

  private buildWhere(): string {
    if (this.whereClauses.length === 0) return ''

    const parts: string[] = []
    for (let i = 0; i < this.whereClauses.length; i++) {
      const clause = this.whereClauses[i]
      const prefix = i === 0 ? '' : ` ${clause.conjunction} `

      if (clause.operator === 'IS' || clause.operator === 'IS NOT') {
        parts.push(`${prefix}${clause.column} ${clause.operator} NULL`)
      } else if (clause.operator === 'IN' || clause.operator === 'NOT IN') {
        const values = clause.value as unknown[]
        const placeholders = values.map((v) => {
          this.params.push(v)
          return this.placeholder()
        })
        parts.push(
          `${prefix}${clause.column} ${clause.operator} (${placeholders.join(', ')})`
        )
      } else if (clause.operator === 'BETWEEN') {
        const [min, max] = clause.value as [unknown, unknown]
        this.params.push(min)
        const minPlaceholder = this.placeholder()
        this.params.push(max)
        const maxPlaceholder = this.placeholder()
        parts.push(
          `${prefix}${clause.column} BETWEEN ${minPlaceholder} AND ${maxPlaceholder}`
        )
      } else {
        this.params.push(clause.value)
        parts.push(
          `${prefix}${clause.column} ${clause.operator} ${this.placeholder()}`
        )
      }
    }

    return ` WHERE ${parts.join('')}`
  }

  private buildGroupBy(): string {
    if (this.groupByColumns.length === 0) return ''
    return ` GROUP BY ${this.groupByColumns.join(', ')}`
  }

  private buildHaving(): string {
    if (this.havingClauses.length === 0) return ''

    const parts: string[] = []
    for (let i = 0; i < this.havingClauses.length; i++) {
      const clause = this.havingClauses[i]
      const prefix = i === 0 ? '' : ` ${clause.conjunction} `
      this.params.push(clause.value)
      parts.push(
        `${prefix}${clause.column} ${clause.operator} ${this.placeholder()}`
      )
    }

    return ` HAVING ${parts.join('')}`
  }

  private buildOrderBy(): string {
    if (this.orderByClauses.length === 0) return ''
    const parts = this.orderByClauses.map(
      (o) => `${o.column} ${o.direction.toUpperCase()}`
    )
    return ` ORDER BY ${parts.join(', ')}`
  }

  private buildLimit(): string {
    let sql = ''
    if (this.limitValue !== undefined) {
      this.params.push(this.limitValue)
      sql += ` LIMIT ${this.placeholder()}`
    }
    if (this.offsetValue !== undefined) {
      this.params.push(this.offsetValue)
      sql += ` OFFSET ${this.placeholder()}`
    }
    return sql
  }

  /**
   * Generate the next placeholder for the current dialect.
   * PostgreSQL: $1, $2, $3...
   * MySQL/SQLite: ?, ?, ?...
   */
  private placeholder(): string {
    if (this.dialect === 'postgres') {
      return `$${this.params.length}`
    }
    return '?'
  }
}
