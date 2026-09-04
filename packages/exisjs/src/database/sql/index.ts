import { ColumnBuilder } from './schema'
import { WhereOperator } from '../types'

export interface SqlCondition {
  column: ColumnBuilder
  operator: WhereOperator
  value: unknown
}

export const eq = (column: ColumnBuilder, value: unknown): SqlCondition => ({
  column,
  operator: '=',
  value,
})

export const gt = (column: ColumnBuilder, value: unknown): SqlCondition => ({
  column,
  operator: '>',
  value,
})

export const gte = (column: ColumnBuilder, value: unknown): SqlCondition => ({
  column,
  operator: '>=',
  value,
})

export const lt = (column: ColumnBuilder, value: unknown): SqlCondition => ({
  column,
  operator: '<',
  value,
})

export const lte = (column: ColumnBuilder, value: unknown): SqlCondition => ({
  column,
  operator: '<=',
  value,
})

export const ne = (column: ColumnBuilder, value: unknown): SqlCondition => ({
  column,
  operator: '!=',
  value,
})

export const isNull = (column: ColumnBuilder): SqlCondition => ({
  column,
  operator: 'IS',
  value: null,
})

export const isNotNull = (column: ColumnBuilder): SqlCondition => ({
  column,
  operator: 'IS NOT',
  value: null,
})

export const inArray = (
  column: ColumnBuilder,
  values: unknown[]
): SqlCondition => ({
  column,
  operator: 'IN',
  value: values,
})

// Export schema builder
export * from './schema'
