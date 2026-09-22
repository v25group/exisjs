import type { ResolveTexType } from './tex-types'

export type TexDefaultValue<T> = T | (() => T)

export interface TexBaseOptions {
  optional?: boolean
  nullable?: boolean
  nullish?: boolean
}

export interface TexStringOptions extends TexBaseOptions {
  min?: number
  max?: number
  trim?: boolean
  collapseWhitespace?: boolean
  toLowerCase?: boolean
  toUpperCase?: boolean
  escapeHtml?: boolean
  stripHtml?: boolean
  slugify?: boolean
  mask?: boolean
  preventSql?: boolean
  preventTraversal?: boolean
  default?: TexDefaultValue<string>
}

export interface TexNumberOptions extends TexBaseOptions {
  min?: number
  max?: number
  coerce?: boolean
  default?: TexDefaultValue<number>
}

export interface TexBooleanOptions extends TexBaseOptions {
  coerce?: boolean
  default?: TexDefaultValue<boolean>
}

export interface TexArrayOptions<T = any> extends TexBaseOptions {
  min?: number
  max?: number
  dedupe?: boolean
  coerce?: boolean
  default?: TexDefaultValue<ResolveTexType<T>[]>
}

export interface TexEnumOptions<
  T extends string = string,
> extends TexBaseOptions {
  default?: TexDefaultValue<T>
}

export interface TexObjectOptions {
  strict?: boolean
}

export interface TexFileOptions extends TexBaseOptions {
  maxSize?: number
  mimeTypes?: string[]
}

export interface TexPasswordOptions extends TexStringOptions {
  requireNumbers?: boolean
  requireSymbols?: boolean
  requireUppercase?: boolean
  requireLowercase?: boolean
}

export interface TexDateOptions extends TexBaseOptions {
  minDate?: string
  maxDate?: string
  coerce?: boolean
  default?: TexDefaultValue<Date | string | number>
}

export interface ValidationErrorDescriptor {
  path: string
  message: string
  expected?: string
  received?: string
  code?: string
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
  hasNext: boolean
  hasPrev: boolean
}

export interface PaginatedResult<T> {
  data: T[]
  pagination: PaginationMeta
}
