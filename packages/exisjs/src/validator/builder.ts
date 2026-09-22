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
import type {
  TexBaseOptions,
  TexStringOptions,
  TexNumberOptions,
  TexBooleanOptions,
  TexArrayOptions,
  TexEnumOptions,
  TexObjectOptions,
  TexFileOptions,
  TexPasswordOptions,
  TexDateOptions,
} from './types'
import { TexEngine } from './engine'

/**
 * Ultra-high performance declarative schema builder powered by the native Rust validator.
 */
export class TexBuilder {
  /**
   * Defines a string schema with built-in sanitization and security protections.
   *
   * @param opts Validation rules and transformations (min, max, trim, toLowerCase, escapeHtml, etc.)
   * @returns Strongly typed string schema descriptor
   *
   * @example
   * ```ts
   * const username = tex.string({ min: 3, max: 20, trim: true, toLowerCase: true })
   * ```
   */
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

  /**
   * Defines a number schema with bounds and optional auto-coercion from string query parameters.
   *
   * @param opts Validation rules (min, max, coerce, default)
   * @returns Strongly typed number schema descriptor
   *
   * @example
   * ```ts
   * const age = tex.number({ min: 18, max: 120, coerce: true })
   * ```
   */
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

  /**
   * Defines a boolean schema with optional string-to-boolean coercion (`"true"`, `"false"`).
   *
   * @param opts Validation rules (coerce, optional, default)
   * @returns Strongly typed boolean schema descriptor
   *
   * @example
   * ```ts
   * const isActive = tex.boolean({ coerce: true, default: true })
   * ```
   */
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

  /**
   * Defines an email schema verified natively against RFC standards.
   *
   * @param opts Validation and formatting rules
   * @returns Strongly typed email string schema descriptor
   *
   * @example
   * ```ts
   * const userEmail = tex.email({ trim: true, toLowerCase: true })
   * ```
   */
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

  /**
   * Defines a UUID v1 or v4 schema.
   *
   * @param opts UUID options including optional version specification
   * @returns Strongly typed UUID string schema descriptor
   */
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

  /**
   * Defines a CUID (Collision-resistant Unique Identifier) schema.
   */
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

  /**
   * Defines a Credit Card schema validated via the Luhn checksum algorithm.
   */
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

  /**
   * Defines a secure password schema with enforcement for length, numbers, symbols, and casing.
   *
   * @param opts Complexity constraints (min, requireNumbers, requireSymbols, requireUppercase, requireLowercase)
   * @returns Strongly typed password schema descriptor
   *
   * @example
   * ```ts
   * const password = tex.password({
   *   min: 8,
   *   requireNumbers: true,
   *   requireSymbols: true,
   *   requireUppercase: true
   * })
   * ```
   */
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

  /**
   * Defines an array schema with item validation, bounds, and automatic coercion from comma-delimited strings.
   *
   * @param schema Schema descriptor for each item in the array
   * @param opts Array rules (min, max, dedupe, coerce, default)
   * @returns Strongly typed array schema descriptor
   *
   * @example
   * ```ts
   * const tags = tex.array(tex.string({ trim: true }), { min: 1, max: 10, dedupe: true })
   * ```
   */
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

  /**
   * Defines an enum schema restricted to an exact list of allowed string literals.
   *
   * @param values Array of allowed string values
   * @param opts Enum options (optional, default)
   * @returns Strongly typed enum schema descriptor
   *
   * @example
   * ```ts
   * const role = tex.enum(['admin', 'user', 'guest'], { default: 'user' })
   * ```
   */
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

  /**
   * Defines an exact literal value schema (e.g. `'v1'`, `42`, `true`).
   */
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

  /**
   * Defines a union schema that succeeds if any of the provided candidate schemas match.
   *
   * @example
   * ```ts
   * const idOrEmail = tex.union([tex.number({ coerce: true }), tex.email()])
   * ```
   */
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

  /**
   * Defines a date schema with bounds checking and automatic coercion from ISO strings or timestamps.
   *
   * @param opts Date options (minDate, maxDate, coerce, default)
   * @returns Strongly typed Date schema descriptor
   *
   * @example
   * ```ts
   * const createdAt = tex.date({ coerce: true, minDate: '2024-01-01' })
   * ```
   */
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

  /**
   * Defines a dynamic key-value record schema (e.g. `Record<string, T>`).
   */
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

  /**
   * Defines an unconstrained pass-through schema.
   */
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

  /**
   * Defines a file upload validation schema.
   */
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

  /**
   * Compiles an object structure into a fast `TexEngine` validator instance.
   *
   * @param schema Object map containing field definitions
   * @param opts Object options (e.g. `{ strict: true }` to reject unknown fields)
   * @returns Compiled `TexEngine` validator
   *
   * @example
   * ```ts
   * const UserSchema = tex.object({
   *   id: tex.number({ coerce: true }),
   *   name: tex.string({ min: 2 }),
   *   email: tex.email()
   * }, { strict: true })
   *
   * const user = UserSchema.parse(req.body)
   * ```
   */
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
   * Dedicated Environment Schema parser (`tex.env`).
   * Automatically coerces numbers, booleans, dates, and arrays from `process.env` string values,
   * while preserving strict type validation and defaults.
   *
   * @param schema Environment variable schema definition
   * @param opts Schema configuration
   * @returns Compiled `TexEngine` tailored for environment variable parsing
   *
   * @example
   * ```ts
   * export const env = tex.env({
   *   PORT: tex.number({ default: 3000 }),
   *   NODE_ENV: tex.enum(['development', 'production', 'test'], { default: 'development' }),
   *   DATABASE_URL: tex.string(),
   *   ENABLE_METRICS: tex.boolean({ default: false })
   * }).parse(process.env)
   * ```
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

  /**
   * Helper that builds standard query pagination schema (`page`, `limit`, `sort`, `order`).
   *
   * @param options Configuration for default and maximum limit
   * @returns Compiled pagination query validator
   *
   * @example
   * ```ts
   * export default controller({
   *   listUsers: route.get('/', {
   *     query: tex.pagination({ defaultLimit: 25, maxLimit: 100 }),
   *     async handle({ query }) {
   *       const { skip, limit } = getPaginationSkip(query)
   *       return UserService.find(skip, limit)
   *     }
   *   })
   * })
   * ```
   */
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
