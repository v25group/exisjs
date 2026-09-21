import { TexValidator } from '@exisjs/rs'
import {
  TexType,
  TexString,
  TexNumber,
  TexBoolean,
  TexArray,
  TexEnum,
  TexLiteral,
  TexUnion,
  TexDate,
  TexRecord,
  TexAny,
  TexFile,
  ResolveSchema,
  ResolveTexType,
} from './tex-types'

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

export class TexBuilder {
  string<O extends TexStringOptions = TexStringOptions>(
    opts?: O
  ): TexString<O['optional'] extends true ? true : false> {
    let base = 'string'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.min !== undefined) base += ` | min:${opts.min}`
    if (opts?.max !== undefined) base += ` | max:${opts.max}`
    if (opts?.trim) base += ' | trim'
    if (opts?.collapseWhitespace) base += ' | collapseWhitespace'
    if (opts?.toLowerCase) base += ' | lowercase'
    if (opts?.toUpperCase) base += ' | uppercase'
    if (opts?.escapeHtml) base += ' | escapeHtml'
    if (opts?.stripHtml) base += ' | stripHtml'
    if (opts?.slugify) base += ' | slugify'
    if (opts?.mask) base += ' | mask'
    if (opts?.preventSql) base += ' | preventSql'
    if (opts?.preventTraversal) base += ' | preventTraversal'
    return new TexType(base, opts?.default) as unknown as TexString<
      O['optional'] extends true ? true : false
    >
  }

  number<O extends TexNumberOptions = TexNumberOptions>(
    opts?: O
  ): TexNumber<O['optional'] extends true ? true : false> {
    let base = 'number'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.coerce) base += ' | coerce'
    if (opts?.min !== undefined) base += ` | min:${opts.min}`
    if (opts?.max !== undefined) base += ` | max:${opts.max}`
    return new TexType(base, opts?.default) as unknown as TexNumber<
      O['optional'] extends true ? true : false
    >
  }

  boolean<O extends TexBooleanOptions = TexBooleanOptions>(
    opts?: O
  ): TexBoolean<O['optional'] extends true ? true : false> {
    let base = 'boolean'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.coerce) base += ' | coerce'
    return new TexType(base, opts?.default) as unknown as TexBoolean<
      O['optional'] extends true ? true : false
    >
  }

  email<O extends TexStringOptions = TexStringOptions>(
    opts?: O
  ): TexString<O['optional'] extends true ? true : false> {
    let base = 'email'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.trim) base += ' | trim'
    if (opts?.toLowerCase) base += ' | lowercase'
    if (opts?.mask) base += ' | mask'
    return new TexType(base, opts?.default) as unknown as TexString<
      O['optional'] extends true ? true : false
    >
  }

  uuid<
    O extends TexStringOptions & { version?: 1 | 4 } = TexStringOptions & {
      version?: 1 | 4
    },
  >(opts?: O): TexString<O['optional'] extends true ? true : false> {
    let base = 'uuid'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.version) base += ` | version:${opts.version}`
    return new TexType(base, opts?.default) as unknown as TexString<
      O['optional'] extends true ? true : false
    >
  }

  cuid<O extends TexStringOptions = TexStringOptions>(
    opts?: O
  ): TexString<O['optional'] extends true ? true : false> {
    let base = 'cuid'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    return new TexType(base, opts?.default) as unknown as TexString<
      O['optional'] extends true ? true : false
    >
  }

  creditCard<O extends TexStringOptions = TexStringOptions>(
    opts?: O
  ): TexString<O['optional'] extends true ? true : false> {
    let base = 'creditcard'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.mask) base += ' | mask'
    return new TexType(base, opts?.default) as unknown as TexString<
      O['optional'] extends true ? true : false
    >
  }

  password<O extends TexPasswordOptions = TexPasswordOptions>(
    opts?: O
  ): TexString<O['optional'] extends true ? true : false> {
    let base = 'password'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.min !== undefined) base += ` | min:${opts.min}`
    if (opts?.max !== undefined) base += ` | max:${opts.max}`
    if (opts?.requireNumbers) base += ' | requireNumbers'
    if (opts?.requireSymbols) base += ' | requireSymbols'
    if (opts?.requireUppercase) base += ' | requireUppercase'
    if (opts?.requireLowercase) base += ' | requireLowercase'
    return new TexType(base, opts?.default) as unknown as TexString<
      O['optional'] extends true ? true : false
    >
  }

  array<T, O extends TexArrayOptions<T> = TexArrayOptions<T>>(
    schema: T,
    opts?: O
  ): TexArray<T, O['optional'] extends true ? true : false> {
    let resolvedItem = schema as any
    if (
      typeof schema === 'object' &&
      schema !== null &&
      !(schema instanceof TexType) &&
      !(schema instanceof TexEngine)
    ) {
      resolvedItem = this.object(schema as any)
    }

    const itemSchema =
      resolvedItem instanceof TexEngine
        ? `object<${JSON.stringify(resolvedItem.getCompiledSchema())}>`
        : resolvedItem instanceof TexType
          ? resolvedItem._raw
          : (resolvedItem as string)
    let base = `array<${itemSchema}>`
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.min !== undefined) base += ` | min:${opts.min}`
    if (opts?.max !== undefined) base += ` | max:${opts.max}`
    if (opts?.dedupe) base += ' | dedupe'
    if (opts?.coerce) base += ' | coerce'
    const res = new TexType(base, opts?.default) as unknown as TexArray<
      T,
      O['optional'] extends true ? true : false
    >
    ;(res as any)._item = resolvedItem
    return res
  }

  enum<T extends string, O extends TexEnumOptions<T> = TexEnumOptions<T>>(
    values: T[],
    opts?: O
  ): TexEnum<T, O['optional'] extends true ? true : false> {
    let base = `enum:${values.join(',')}`
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    return new TexType(base, opts?.default) as unknown as TexEnum<
      T,
      O['optional'] extends true ? true : false
    >
  }

  literal<
    T extends string | number | boolean,
    O extends TexBaseOptions = TexBaseOptions,
  >(
    value: T,
    opts?: O
  ): TexLiteral<T, O['optional'] extends true ? true : false> {
    let base = `literal:${value}`
    if (opts?.optional) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    return new TexType(base) as unknown as TexLiteral<
      T,
      O['optional'] extends true ? true : false
    >
  }

  union<T extends any[], O extends TexBaseOptions = TexBaseOptions>(
    schemas: T,
    opts?: O
  ): TexUnion<T, O['optional'] extends true ? true : false> {
    const items = schemas.map((s) => (s instanceof TexType ? s._raw : s))
    let base = items.join(' || ')
    if (opts?.optional) base = `(${base})?`
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    return new TexType(base) as unknown as TexUnion<
      T,
      O['optional'] extends true ? true : false
    >
  }

  date<O extends TexDateOptions = TexDateOptions>(
    opts?: O
  ): TexDate<O['optional'] extends true ? true : false> {
    let base = 'date'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.coerce) base += ' | coerce'
    if (opts?.minDate) base += ` | minDate:${opts.minDate}`
    if (opts?.maxDate) base += ` | maxDate:${opts.maxDate}`
    return new TexType(base, opts?.default) as unknown as TexDate<
      O['optional'] extends true ? true : false
    >
  }

  record<T, O extends TexBaseOptions = TexBaseOptions>(
    schema: T,
    opts?: O
  ): TexRecord<T, O['optional'] extends true ? true : false> {
    const itemSchema = schema instanceof TexType ? schema._raw : schema
    let base = `record<${itemSchema as string}>`
    if (opts?.optional) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    return new TexType(base) as unknown as TexRecord<
      T,
      O['optional'] extends true ? true : false
    >
  }

  any<O extends TexBaseOptions = TexBaseOptions>(
    opts?: O
  ): TexAny<O['optional'] extends true ? true : false> {
    let base = 'any'
    if (opts?.optional) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    return new TexType(base) as unknown as TexAny<
      O['optional'] extends true ? true : false
    >
  }

  file<O extends TexFileOptions = TexFileOptions>(
    opts?: O
  ): TexFile<O['optional'] extends true ? true : false> {
    let base = 'file'
    if (opts?.optional) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.maxSize) base += ` | maxSize:${opts.maxSize}`
    if (opts?.mimeTypes) base += ` | mimeTypes:${opts.mimeTypes.join(',')}`
    return new TexType(base) as unknown as TexFile<
      O['optional'] extends true ? true : false
    >
  }

  object<T extends Record<string, any>>(
    schema: T,
    opts?: TexObjectOptions
  ): TexEngine<ResolveSchema<T>> {
    const compiledSchema: Record<string, string> = {}
    for (const [key, value] of Object.entries(schema)) {
      if (value instanceof TexEngine) {
        compiledSchema[key] =
          `object<${JSON.stringify(value.getCompiledSchema())}>`
      } else if (value instanceof TexType) {
        compiledSchema[key] = value._raw
      } else {
        compiledSchema[key] = value as string
      }
    }
    return new TexEngine(compiledSchema, schema, opts?.strict)
  }

  /**
   * Dedicated Environment Schema parser (tex.env).
   * Automatically coerces numbers, booleans, dates, and arrays from process.env string values,
   * while preserving strict type validation and defaults.
   */
  env<T extends Record<string, any>>(
    schema: T,
    opts?: TexObjectOptions
  ): TexEngine<ResolveSchema<T>> {
    const coercedSchema: Record<string, any> = {}
    for (const [key, value] of Object.entries(schema)) {
      if (value instanceof TexType) {
        let raw = value._raw
        // Auto-inject coercion if not already present
        if (
          (raw.startsWith('number') ||
            raw.startsWith('boolean') ||
            raw.startsWith('date') ||
            raw.startsWith('array<')) &&
          !raw.includes('coerce')
        ) {
          raw = `${raw} | coerce`
        }
        const cloned = new TexType(raw, value.defaultValue)
        cloned.sanitizers = [...value.sanitizers]
        cloned.refinements = [...value.refinements]
        if ((value as any)._item) {
          ;(cloned as any)._item = (value as any)._item
        }
        coercedSchema[key] = cloned
      } else if (value instanceof TexEngine) {
        coercedSchema[key] = value
      } else if (typeof value === 'string') {
        let raw = value
        if (
          (raw.startsWith('number') ||
            raw.startsWith('boolean') ||
            raw.startsWith('date') ||
            raw.startsWith('array<')) &&
          !raw.includes('coerce')
        ) {
          raw = `${raw} | coerce`
        }
        coercedSchema[key] = new TexType(raw)
      } else {
        coercedSchema[key] = value
      }
    }
    return this.object(coercedSchema as T, opts)
  }

  pagination(options?: { defaultLimit?: number; maxLimit?: number }) {
    const defaultLimit = options?.defaultLimit ?? 10
    const maxLimit = options?.maxLimit ?? 100
    return this.object({
      page: this.number({ optional: true, coerce: true, min: 1, default: 1 }),
      limit: this.number({
        optional: true,
        coerce: true,
        min: 1,
        max: maxLimit,
        default: defaultLimit,
      }),
      sort: this.string({ optional: true, trim: true }),
      order: this.enum(['asc', 'desc'], { optional: true }),
    })
  }
}

export interface ValidationErrorDescriptor {
  path: string
  message: string
  expected?: string
  received?: string
  code?: string
}

function getNestedValue(obj: any, path: string): any {
  if (!obj || typeof obj !== 'object' || !path) return undefined
  if (path in obj) return obj[path]
  try {
    const keys = path.replace(/\[(\w+)\]/g, '.$1').split('.')
    let curr = obj
    for (const k of keys) {
      if (curr === undefined || curr === null) return undefined
      curr = curr[k]
    }
    return curr
  } catch {
    return undefined
  }
}

function formatReceivedValue(val: any): string {
  if (val === undefined) return 'undefined'
  if (val === null) return 'null'
  if (typeof val === 'string') return JSON.stringify(val)
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) {
    try {
      const str = JSON.stringify(val)
      return str.length > 30 ? `Array(${val.length})` : str
    } catch {
      return `Array(${val.length})`
    }
  }
  if (typeof val === 'object') {
    try {
      const str = JSON.stringify(val)
      return str.length > 30 ? '[object Object]' : str
    } catch {
      return '[object Object]'
    }
  }
  return String(val)
}

export class ValidatorError extends Error {
  public readonly errors: ValidationErrorDescriptor[]
  public httpPart?: string
  public routePath?: string
  public routeMethod?: string
  public received?: any

  constructor(errors: ValidationErrorDescriptor[]) {
    super(
      'Validation Error: ' +
        errors.map((e) => `${e.path}: ${e.message}`).join(', ')
    )
    this.name = 'ValidatorError'
    this.errors = errors
  }
}

export class TexEngine<T = any> {
  private schema: Record<string, string>
  private rawSchema: Record<string, any>
  private validator: any
  private strict: boolean

  public readonly _type!: T
  public _isOptional = false

  constructor(
    schema: Record<string, string>,
    rawSchema: Record<string, any>,
    strict = false,
    isOptional = false
  ) {
    this.schema = schema
    this.rawSchema = rawSchema
    this.strict = strict
    this._isOptional = isOptional
    this.validator = new TexValidator(schema, strict)
  }

  getCompiledSchema() {
    return this.schema
  }

  optional(): TexEngine<T | undefined> {
    return new TexEngine(this.schema, this.rawSchema, this.strict, true) as any
  }

  partial(): TexEngine<Partial<T>> {
    const newSchema: Record<string, string> = {}
    const newRaw: Record<string, any> = {}
    for (const [key, val] of Object.entries(this.schema)) {
      newSchema[key] = val.includes('?') ? val : `${val}?`
      const rawVal = this.rawSchema[key]
      if (rawVal instanceof TexType) {
        newRaw[key] = new TexType(newSchema[key])
        newRaw[key].sanitizers = rawVal.sanitizers
        newRaw[key].refinements = rawVal.refinements
      } else if (rawVal instanceof TexEngine) {
        newRaw[key] = rawVal.optional()
      } else {
        newRaw[key] = newSchema[key]
      }
    }
    return new TexEngine(newSchema, newRaw, this.strict, this._isOptional)
  }

  pick<K extends keyof T>(keys: K[]): TexEngine<Pick<T, K>> {
    const newSchema: Record<string, string> = {}
    const newRaw: Record<string, any> = {}
    for (const key of keys as string[]) {
      if (this.schema[key]) {
        newSchema[key] = this.schema[key]
        newRaw[key] = this.rawSchema[key]
      }
    }
    return new TexEngine(
      newSchema,
      newRaw,
      this.strict,
      this._isOptional
    ) as any
  }

  omit<K extends keyof T>(keys: K[]): TexEngine<Omit<T, K>> {
    const newSchema: Record<string, string> = {}
    const newRaw: Record<string, any> = {}
    for (const [key, val] of Object.entries(this.schema)) {
      if (!keys.includes(key as any)) {
        newSchema[key] = val
        newRaw[key] = this.rawSchema[key]
      }
    }
    return new TexEngine(
      newSchema,
      newRaw,
      this.strict,
      this._isOptional
    ) as any
  }

  parse(data: any): T {
    // 1. Apply defaults and run pre-validation sanitizers on the raw payload (if it's an object)
    if (data && typeof data === 'object') {
      for (const [key, val] of Object.entries(this.rawSchema)) {
        // Apply default value / lazy factory function if field is omitted or undefined
        if (data[key] === undefined) {
          if (val instanceof TexType && val.defaultValue !== undefined) {
            data[key] =
              typeof val.defaultValue === 'function'
                ? val.defaultValue()
                : val.defaultValue
          }
        }

        if (typeof data[key] === 'string' && data[key].trim() === '') {
          const raw = val instanceof TexType ? val._raw : String(val)
          if (
            raw.includes('optional') ||
            raw.includes('nullable') ||
            raw.includes('nullish') ||
            raw.includes('?') ||
            (val as any)?._isOptional
          ) {
            if (
              raw.includes('nullable') &&
              !raw.includes('optional') &&
              !raw.includes('nullish')
            ) {
              data[key] = null
            } else {
              delete data[key]
              // If deleted but default is defined, apply default
              if (val instanceof TexType && val.defaultValue !== undefined) {
                data[key] =
                  typeof val.defaultValue === 'function'
                    ? val.defaultValue()
                    : val.defaultValue
              }
            }
          }
        }
        if (data[key] !== undefined && data[key] !== null) {
          if (val instanceof TexType && val._raw.startsWith('date')) {
            if (val._raw.includes('coerce')) {
              if (
                typeof data[key] === 'string' ||
                typeof data[key] === 'number'
              ) {
                const d = new Date(data[key])
                if (isNaN(d.getTime())) {
                  throw new ValidatorError([
                    {
                      path: key,
                      message: 'Must be a valid date',
                      expected: 'valid date string or timestamp',
                      received: formatReceivedValue(data[key]),
                      code: 'INVALID_DATE',
                    },
                  ])
                }
                data[key] = d
              }
            }
            if (
              !(data[key] instanceof Date) &&
              typeof data[key] !== 'string' &&
              typeof data[key] !== 'number'
            ) {
              throw new ValidatorError([
                {
                  path: key,
                  message: 'Must be a valid date',
                  expected: 'valid date or date string',
                  received: formatReceivedValue(data[key]),
                  code: 'INVALID_TYPE',
                },
              ])
            }
            if (data[key] instanceof Date && isNaN(data[key].getTime())) {
              throw new ValidatorError([
                {
                  path: key,
                  message: 'Must be a valid date',
                  expected: 'valid date string or timestamp',
                  received: formatReceivedValue(data[key]),
                  code: 'INVALID_DATE',
                },
              ])
            }
            if (val._raw.includes('minDate:')) {
              const minStr = val._raw.match(/minDate:([^\s|]+)/)?.[1]
              if (
                minStr &&
                new Date(data[key]).getTime() < new Date(minStr).getTime()
              ) {
                throw new ValidatorError([
                  {
                    path: key,
                    message: `Date must be after ${minStr}`,
                    expected: `>= ${minStr}`,
                    received: formatReceivedValue(data[key]),
                    code: 'DATE_TOO_EARLY',
                  },
                ])
              }
            }
            if (val._raw.includes('maxDate:')) {
              const maxStr = val._raw.match(/maxDate:([^\s|]+)/)?.[1]
              if (
                maxStr &&
                new Date(data[key]).getTime() > new Date(maxStr).getTime()
              ) {
                throw new ValidatorError([
                  {
                    path: key,
                    message: `Date must be before ${maxStr}`,
                    expected: `<= ${maxStr}`,
                    received: formatReceivedValue(data[key]),
                    code: 'DATE_TOO_LATE',
                  },
                ])
              }
            }
          }

          if (
            val instanceof TexType &&
            val._raw.startsWith('array<') &&
            val._raw.includes('coerce')
          ) {
            if (!Array.isArray(data[key])) {
              if (typeof data[key] === 'string') {
                const parts = data[key].includes(',')
                  ? data[key].split(',').map((s: string) => s.trim())
                  : [data[key]]
                if (val._raw.startsWith('array<number')) {
                  data[key] = parts.map((p: string) => {
                    const n = Number(p)
                    return isNaN(n) ? p : n
                  })
                } else if (val._raw.startsWith('array<boolean')) {
                  data[key] = parts.map((p: string) => {
                    if (p.toLowerCase() === 'true') return true
                    if (p.toLowerCase() === 'false') return false
                    return p
                  })
                } else {
                  data[key] = parts
                }
              } else {
                data[key] = [data[key]]
              }
            } else {
              if (val._raw.startsWith('array<number')) {
                data[key] = data[key].map((item: any) => {
                  if (typeof item === 'string') {
                    const n = Number(item)
                    return isNaN(n) ? item : n
                  }
                  return item
                })
              } else if (val._raw.startsWith('array<boolean')) {
                data[key] = data[key].map((item: any) => {
                  if (typeof item === 'string') {
                    if (item.toLowerCase() === 'true') return true
                    if (item.toLowerCase() === 'false') return false
                  }
                  return item
                })
              }
            }
          }

          if (val instanceof TexType && val.sanitizers.length > 0) {
            for (const s of val.sanitizers) {
              if (data[key] === undefined || data[key] === null) break
              data[key] = s(data[key])
            }
          }

          const itemSchema = (val as any)?._item
          if (itemSchema && Array.isArray(data[key])) {
            if (
              itemSchema instanceof TexType &&
              itemSchema.sanitizers.length > 0
            ) {
              for (let i = 0; i < data[key].length; i++) {
                if (data[key][i] !== undefined && data[key][i] !== null) {
                  for (const s of itemSchema.sanitizers) {
                    if (data[key][i] === undefined || data[key][i] === null)
                      break
                    data[key][i] = s(data[key][i])
                  }
                }
              }
            }
          }
        }
      }
    }

    // 2. Rust Validation
    let parsedData: any
    try {
      parsedData = this.validator.parse(data)
    } catch (err: any) {
      if (
        data === process.env &&
        (process.env.__EXIS_SKIP_ENV_CHECK === 'true' ||
          process.env.EXIS_SKIP_ENV_CHECK === 'true')
      ) {
        const mock: any = { ...data }
        for (const [key, val] of Object.entries(this.rawSchema)) {
          if (mock[key] === undefined) {
            const raw = val instanceof TexType ? val._raw : String(val)
            if (raw.includes('number')) mock[key] = 0
            else if (raw.includes('boolean')) mock[key] = false
            else if (raw.includes('array')) mock[key] = []
            else mock[key] = `mock_${key}`
          }
        }
        return mock as T
      }

      let path = 'root'
      let message = err.message || 'Validation failed'
      let expected: string | undefined
      let code = 'VALIDATION_ERROR'

      if (message.startsWith('Missing required field: ')) {
        path = message.replace('Missing required field: ', '').trim()
        message = 'Expected value, received undefined'
        expected = 'defined'
        code = 'MISSING_REQUIRED_FIELD'
      } else if (message.startsWith("Field '")) {
        const match = message.match(/Field '([^']+)' (.+)/)
        if (match) {
          path = match[1]
          const constraint = match[2]
          message = constraint.charAt(0).toUpperCase() + constraint.slice(1)

          if (constraint.startsWith('must be a string')) {
            expected = 'string'
            code = 'INVALID_TYPE'
          } else if (constraint.startsWith('must be a number')) {
            expected = 'number'
            code = 'INVALID_TYPE'
          } else if (constraint.startsWith('must be a boolean')) {
            expected = 'boolean'
            code = 'INVALID_TYPE'
          } else if (
            constraint.startsWith('must be an array') ||
            constraint.includes('array must have') ||
            constraint.includes('array exceeds')
          ) {
            expected = 'array'
            code = constraint.includes('array must have')
              ? 'ARRAY_TOO_SHORT'
              : constraint.includes('array exceeds')
                ? 'ARRAY_TOO_LONG'
                : 'INVALID_TYPE'
          } else if (constraint.startsWith('must be an object')) {
            expected = 'object'
            code = 'INVALID_TYPE'
          } else if (constraint.startsWith('must be a valid email')) {
            expected = 'valid email address'
            code = 'INVALID_EMAIL'
          } else if (constraint.startsWith('must be one of')) {
            expected = constraint.replace('must be one of', '').trim()
            code = 'INVALID_ENUM_VALUE'
          } else if (
            constraint.startsWith('must be at least') ||
            constraint.startsWith('must be >=')
          ) {
            expected = constraint
            code = 'VALUE_TOO_SMALL'
          } else if (
            constraint.startsWith('must be at most') ||
            constraint.startsWith('must be <=')
          ) {
            expected = constraint
            code = 'VALUE_TOO_LARGE'
          } else if (constraint.startsWith('must contain a number')) {
            expected = 'must contain at least one digit'
            code = 'PASSWORD_REQUIRES_NUMBER'
          } else if (constraint.startsWith('must contain an uppercase')) {
            expected = 'must contain at least one uppercase letter'
            code = 'PASSWORD_REQUIRES_UPPERCASE'
          } else if (constraint.startsWith('must contain a lowercase')) {
            expected = 'must contain at least one lowercase letter'
            code = 'PASSWORD_REQUIRES_LOWERCASE'
          } else if (constraint.startsWith('must contain a symbol')) {
            expected = 'must contain at least one symbol'
            code = 'PASSWORD_REQUIRES_SYMBOL'
          } else {
            expected = constraint
          }
        }
      } else if (message.startsWith("Strict mode error: Unknown field '")) {
        const match = message.match(
          /Strict mode error: Unknown field '([^']+)'(?: at path '([^']*)')?/
        )
        if (match) {
          const key = match[1]
          const parentPath = match[2]
          path =
            parentPath && parentPath.length > 0 ? `${parentPath}.${key}` : key
          message = 'Unknown field not allowed in strict mode'
          expected = 'undefined (field omitted)'
          code = 'UNRECOGNIZED_KEYS'
        }
      }

      const receivedRaw = getNestedValue(data, path)
      const received = formatReceivedValue(receivedRaw)

      throw new ValidatorError([{ path, message, expected, received, code }])
    }

    // Preserve Date objects and ensure defaults are applied
    if (parsedData && typeof parsedData === 'object') {
      for (const [key, val] of Object.entries(this.rawSchema)) {
        if (
          parsedData[key] === undefined &&
          val instanceof TexType &&
          val.defaultValue !== undefined
        ) {
          parsedData[key] =
            typeof val.defaultValue === 'function'
              ? val.defaultValue()
              : val.defaultValue
        }
        if (
          val instanceof TexType &&
          val._raw.startsWith('date') &&
          data &&
          data[key] instanceof Date
        ) {
          parsedData[key] = data[key]
        }
      }
    }

    // 3. Post-validation synchronous refinements
    const errors: ValidationErrorDescriptor[] = []
    if (parsedData && typeof parsedData === 'object') {
      for (const [key, val] of Object.entries(this.rawSchema)) {
        if (parsedData[key] !== undefined) {
          const isNullableField =
            val instanceof TexType &&
            (val._raw.includes('nullable') || val._raw.includes('nullish'))
          if (parsedData[key] === null && isNullableField) {
            continue
          }

          if (val instanceof TexType && val.refinements.length > 0) {
            for (const r of val.refinements) {
              if (!r.async && !r.fn(parsedData[key])) {
                const msg =
                  typeof r.message === 'function'
                    ? r.message(parsedData[key])
                    : r.message || 'Invalid value'
                errors.push({
                  path: key,
                  message: msg,
                  expected: 'custom refinement rule',
                  received: formatReceivedValue(parsedData[key]),
                  code: 'CUSTOM_VALIDATION',
                })
              }
            }
          }
          const itemSchema = (val as any)?._item
          if (itemSchema && Array.isArray(parsedData[key])) {
            if (
              itemSchema instanceof TexType &&
              itemSchema.refinements.length > 0
            ) {
              const isItemNullable =
                itemSchema._raw.includes('nullable') ||
                itemSchema._raw.includes('nullish')
              for (let i = 0; i < parsedData[key].length; i++) {
                if (parsedData[key][i] === null && isItemNullable) continue
                for (const r of itemSchema.refinements) {
                  if (!r.async && !r.fn(parsedData[key][i])) {
                    const msg =
                      typeof r.message === 'function'
                        ? r.message(parsedData[key][i])
                        : r.message || 'Invalid value'
                    errors.push({
                      path: `${key}[${i}]`,
                      message: msg,
                      expected: 'custom refinement rule',
                      received: formatReceivedValue(parsedData[key][i]),
                      code: 'CUSTOM_VALIDATION',
                    })
                  }
                }
              }
            }
          }
        }
      }
    }

    if (errors.length > 0) throw new ValidatorError(errors)
    return parsedData
  }

  async parseAsync(data: any): Promise<T> {
    const parsed = this.parse(data) // Handles sync sanitizers + rust + sync refine

    const errors: ValidationErrorDescriptor[] = []
    if (parsed && typeof parsed === 'object') {
      await Promise.all(
        Object.entries(this.rawSchema).map(async ([key, val]) => {
          const valData = parsed[key as keyof T]
          const isNullableField =
            val instanceof TexType &&
            (val._raw.includes('nullable') || val._raw.includes('nullish'))
          if (valData === null && isNullableField) return

          if (
            valData !== undefined &&
            val instanceof TexType &&
            val.refinements.length > 0
          ) {
            for (const r of val.refinements) {
              if (r.async && !(await r.fn(valData))) {
                const msg =
                  typeof r.message === 'function'
                    ? r.message(valData)
                    : r.message || 'Invalid value'
                errors.push({
                  path: key,
                  message: msg,
                  expected: 'custom async refinement rule',
                  received: formatReceivedValue(valData),
                  code: 'CUSTOM_VALIDATION',
                })
              }
            }
          }
        })
      )
    }

    if (errors.length > 0) throw new ValidatorError(errors)
    return parsed
  }

  toMongoSchema(): Record<string, any> {
    const schemaDef: Record<string, any> = {}
    for (const [key, rawDef] of Object.entries(this.schema)) {
      const typeStr = rawDef.split('|')[0].trim()
      const isOptional = typeStr.endsWith('?')
      const baseType = typeStr.replace('?', '')
      const field: any = {}

      if (
        baseType.startsWith('string') ||
        baseType.startsWith('email') ||
        baseType.startsWith('uuid') ||
        baseType.startsWith('cuid') ||
        baseType.startsWith('password')
      )
        field.type = String
      else if (baseType.startsWith('number')) field.type = Number
      else if (baseType.startsWith('boolean')) field.type = Boolean
      else if (baseType.startsWith('date')) field.type = Date
      else field.type = Object // 'Mixed' essentially or nested

      if (!isOptional) field.required = true
      schemaDef[key] = field
    }
    return schemaDef
  }

  toOpenApi(): Record<string, any> {
    const properties: Record<string, any> = {}
    const required: string[] = []
    for (const [key, rawDef] of Object.entries(this.schema)) {
      const typeStr = rawDef.split('|')[0].trim()
      const isOptional = typeStr.endsWith('?')
      const baseType = typeStr.replace('?', '')
      const prop: any = {}

      if (
        baseType.startsWith('string') ||
        baseType.startsWith('uuid') ||
        baseType.startsWith('cuid') ||
        baseType.startsWith('password')
      )
        prop.type = 'string'
      else if (baseType.startsWith('email')) {
        prop.type = 'string'
        prop.format = 'email'
      } else if (baseType.startsWith('number')) prop.type = 'number'
      else if (baseType.startsWith('boolean')) prop.type = 'boolean'
      else if (baseType.startsWith('date')) prop.type = 'string'
      else if (baseType.startsWith('array<')) prop.type = 'array'
      else if (baseType.startsWith('enum:'))
        prop.type = 'string' // Simplification
      else prop.type = 'object'

      properties[key] = prop
      if (!isOptional) required.push(key)
    }
    const result: any = { type: 'object', properties }
    if (required.length > 0) result.required = required
    return result
  }
}

export const tex = new TexBuilder()

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

export function paginate<T>(
  data: T[],
  total: number,
  options: { page?: number; limit?: number } = {}
): PaginatedResult<T> {
  const page = Math.max(1, Number(options.page) || 1)
  const limit = Math.max(1, Number(options.limit) || 20)
  const totalPages = Math.ceil(total / limit)
  const hasNext = page < totalPages
  const hasPrev = page > 1

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: hasNext,
      hasPrevPage: hasPrev,
      hasNext,
      hasPrev,
    },
  }
}

export function getPaginationSkip(
  query: { page?: number; limit?: number } = {}
): {
  skip: number
  limit: number
  page: number
} {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.max(1, Number(query.limit) || 20)
  return {
    skip: (page - 1) * limit,
    limit,
    page,
  }
}
