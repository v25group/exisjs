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
} from './tex-types'

export interface TexBaseOptions {
  optional?: boolean
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
}

export interface TexNumberOptions extends TexBaseOptions {
  min?: number
  max?: number
  coerce?: boolean
}

export interface TexBooleanOptions extends TexBaseOptions {
  coerce?: boolean
}

export interface TexArrayOptions extends TexBaseOptions {
  min?: number
  max?: number
  dedupe?: boolean
}

export interface TexEnumOptions extends TexBaseOptions {
  default?: string
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

export class TexBuilder {
  string<O extends TexStringOptions = TexStringOptions>(
    opts?: O
  ): TexString<O['optional'] extends true ? true : false> {
    let base = 'string'
    if (opts?.optional) base += '?'
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
    return new TexType(base) as unknown as TexString<
      O['optional'] extends true ? true : false
    >
  }

  number<O extends TexNumberOptions = TexNumberOptions>(
    opts?: O
  ): TexNumber<O['optional'] extends true ? true : false> {
    let base = 'number'
    if (opts?.optional) base += '?'
    if (opts?.coerce) base += ' | coerce'
    if (opts?.min !== undefined) base += ` | min:${opts.min}`
    if (opts?.max !== undefined) base += ` | max:${opts.max}`
    return new TexType(base) as unknown as TexNumber<
      O['optional'] extends true ? true : false
    >
  }

  boolean<O extends TexBooleanOptions = TexBooleanOptions>(
    opts?: O
  ): TexBoolean<O['optional'] extends true ? true : false> {
    let base = 'boolean'
    if (opts?.optional) base += '?'
    if (opts?.coerce) base += ' | coerce'
    return new TexType(base) as unknown as TexBoolean<
      O['optional'] extends true ? true : false
    >
  }

  email<O extends TexStringOptions = TexStringOptions>(
    opts?: O
  ): TexString<O['optional'] extends true ? true : false> {
    let base = 'email'
    if (opts?.optional) base += '?'
    if (opts?.trim) base += ' | trim'
    if (opts?.toLowerCase) base += ' | lowercase'
    if (opts?.mask) base += ' | mask'
    return new TexType(base) as unknown as TexString<
      O['optional'] extends true ? true : false
    >
  }

  uuid<
    O extends TexStringOptions & { version?: 1 | 4 } = TexStringOptions & {
      version?: 1 | 4
    },
  >(opts?: O): TexString<O['optional'] extends true ? true : false> {
    let base = 'uuid'
    if (opts?.optional) base += '?'
    if (opts?.version) base += ` | version:${opts.version}`
    return new TexType(base) as unknown as TexString<
      O['optional'] extends true ? true : false
    >
  }

  cuid<O extends TexStringOptions = TexStringOptions>(
    opts?: O
  ): TexString<O['optional'] extends true ? true : false> {
    let base = 'cuid'
    if (opts?.optional) base += '?'
    return new TexType(base) as unknown as TexString<
      O['optional'] extends true ? true : false
    >
  }

  creditCard<O extends TexStringOptions = TexStringOptions>(
    opts?: O
  ): TexString<O['optional'] extends true ? true : false> {
    let base = 'creditcard'
    if (opts?.optional) base += '?'
    if (opts?.mask) base += ' | mask'
    return new TexType(base) as unknown as TexString<
      O['optional'] extends true ? true : false
    >
  }

  password<O extends TexPasswordOptions = TexPasswordOptions>(
    opts?: O
  ): TexString<O['optional'] extends true ? true : false> {
    let base = 'password'
    if (opts?.optional) base += '?'
    if (opts?.min !== undefined) base += ` | min:${opts.min}`
    if (opts?.max !== undefined) base += ` | max:${opts.max}`
    if (opts?.requireNumbers) base += ' | requireNumbers'
    if (opts?.requireSymbols) base += ' | requireSymbols'
    if (opts?.requireUppercase) base += ' | requireUppercase'
    if (opts?.requireLowercase) base += ' | requireLowercase'
    return new TexType(base) as unknown as TexString<
      O['optional'] extends true ? true : false
    >
  }

  array<T, O extends TexArrayOptions = TexArrayOptions>(
    schema: T,
    opts?: O
  ): TexArray<T, O['optional'] extends true ? true : false> {
    const itemSchema = schema instanceof TexType ? schema._raw : schema
    let base = `array<${itemSchema as string}>`
    if (opts?.optional) base += '?'
    if (opts?.min !== undefined) base += ` | min:${opts.min}`
    if (opts?.max !== undefined) base += ` | max:${opts.max}`
    if (opts?.dedupe) base += ' | dedupe'
    return new TexType(base) as unknown as TexArray<
      T,
      O['optional'] extends true ? true : false
    >
  }

  enum<T extends string, O extends TexEnumOptions = TexEnumOptions>(
    values: T[],
    opts?: O
  ): TexEnum<T, O['optional'] extends true ? true : false> {
    let base = `enum:${values.join(',')}`
    if (opts?.optional) base += '?'
    if (opts?.default) base += ` | default:${opts.default}`
    return new TexType(base) as unknown as TexEnum<
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
    return new TexType(base) as unknown as TexUnion<
      T,
      O['optional'] extends true ? true : false
    >
  }

  date<
    O extends TexBaseOptions & { minDate?: string; maxDate?: string } =
      TexBaseOptions & { minDate?: string; maxDate?: string },
  >(opts?: O): TexDate<O['optional'] extends true ? true : false> {
    let base = 'date'
    if (opts?.optional) base += '?'
    if (opts?.minDate) base += ` | minDate:${opts.minDate}`
    if (opts?.maxDate) base += ` | maxDate:${opts.maxDate}`
    return new TexType(base) as unknown as TexDate<
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
    return new TexType(base) as unknown as TexAny<
      O['optional'] extends true ? true : false
    >
  }

  file<O extends TexFileOptions = TexFileOptions>(
    opts?: O
  ): TexFile<O['optional'] extends true ? true : false> {
    let base = 'file'
    if (opts?.optional) base += '?'
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
}

export class ValidatorError extends Error {
  constructor(public errors: { path: string; message: string }[]) {
    super(
      'Validation Error: ' +
        errors.map((e) => `${e.path}: ${e.message}`).join(', ')
    )
    this.name = 'ValidatorError'
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
    // 1. Run pre-validation sanitizers on the raw payload (if it's an object)
    if (data && typeof data === 'object') {
      for (const [key, val] of Object.entries(this.rawSchema)) {
        if (
          data[key] !== undefined &&
          val instanceof TexType &&
          val.sanitizers.length > 0
        ) {
          for (const s of val.sanitizers) {
            data[key] = s(data[key])
          }
        }
      }
    }

    // 2. Rust Validation
    let parsedData: any
    try {
      parsedData = this.validator.parse(data)
    } catch (err: any) {
      // N-API throws generic Error strings from Rust
      throw new ValidatorError([{ path: 'root', message: err.message }])
    }

    // 3. Post-validation synchronous refinements
    const errors: { path: string; message: string }[] = []
    if (parsedData && typeof parsedData === 'object') {
      for (const [key, val] of Object.entries(this.rawSchema)) {
        if (
          parsedData[key] !== undefined &&
          val instanceof TexType &&
          val.refinements.length > 0
        ) {
          for (const r of val.refinements) {
            if (!r.async && !r.fn(parsedData[key])) {
              const msg =
                typeof r.message === 'function'
                  ? r.message(parsedData[key])
                  : r.message || 'Invalid value'
              errors.push({ path: key, message: msg })
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

    const errors: { path: string; message: string }[] = []
    if (parsed && typeof parsed === 'object') {
      await Promise.all(
        Object.entries(this.rawSchema).map(async ([key, val]) => {
          if (
            parsed[key as keyof T] !== undefined &&
            val instanceof TexType &&
            val.refinements.length > 0
          ) {
            for (const r of val.refinements) {
              if (r.async && !(await r.fn(parsed[key as keyof T]))) {
                const msg =
                  typeof r.message === 'function'
                    ? r.message(parsed[key as keyof T])
                    : r.message || 'Invalid value'
                errors.push({ path: key, message: msg })
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
