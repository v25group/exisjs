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
  type WithDefault,
  type ResolveInput,
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
  TexUrlOptions,
} from './types'
import { TexEngine, TexDiscriminatedUnionEngine, fieldRule } from './engine'
import { formatEnumValues } from './rules'

const OBJECT_OPTIONS = ['strict', 'optional', 'nullable', 'nullish']

// Plain JavaScript gets no type error for a misspelled option, so refuse it
function checkObjectOptions(opts: unknown): void {
  if (opts === undefined) return
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw new TypeError('tex.object(): options must be an object')
  }
  for (const key of Object.keys(opts)) {
    if (!OBJECT_OPTIONS.includes(key)) {
      throw new TypeError(
        `tex.object(): unknown option "${key}". Supported: ${OBJECT_OPTIONS.join(', ')}`
      )
    }
  }
}

type OptionalFlag<O> = O extends { optional: true } | { nullish: true }
  ? true
  : false
type NullableFlag<O> = O extends { nullable: true } | { nullish: true }
  ? true
  : false

/** What `tex.object(shape, options)` returns */
export type ObjectSchema<T extends Record<string, any>, O> = TexEngine<
  | ResolveSchema<T>
  | (NullableFlag<O> extends true ? null : never)
  | (OptionalFlag<O> extends true ? undefined : never)
> & { readonly _input: ResolveInput<T> } & (OptionalFlag<O> extends true
    ? { readonly __isOptional: true }
    : unknown)

// `length` and `pattern` for string-like schemas
function textChecks(opts?: { length?: number; pattern?: RegExp }): string {
  let out = ''
  if (opts?.length !== undefined) out += ` | length:${opts.length}`
  if (opts?.pattern) {
    out += ` | pattern:${JSON.stringify([opts.pattern.source, opts.pattern.flags])}`
  }
  return out
}

/**
 * Declarative schema builder; each schema compiles once into plain JS checks.
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
  ): WithDefault<TexString<O['optional'] extends true ? true : false>, O> {
    let base = 'string'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.coerce) base += ' | coerce'
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
    return new TexType(base + textChecks(opts), opts?.default) as any
  }

  /**
   * Defines an absolute URL schema. Only `http` and `https` are accepted
   * unless `protocols` says otherwise.
   *
   * @example
   * ```ts
   * const website = tex.url({ trim: true })
   * const callback = tex.url({ protocols: ['https'] })
   * ```
   */
  url<O extends TexUrlOptions = TexUrlOptions>(
    opts?: O
  ): WithDefault<TexString<O['optional'] extends true ? true : false>, O> {
    let base = 'url'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.trim) base += ' | trim'
    if (opts?.protocols?.length) {
      base += ` | protocols:${opts.protocols.map((p) => p.replace(/:$/, '')).join(',')}`
    }
    if (opts?.min !== undefined) base += ` | min:${opts.min}`
    if (opts?.max !== undefined) base += ` | max:${opts.max}`
    return new TexType(base + textChecks(opts), opts?.default) as any
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
  ): WithDefault<TexNumber<O['optional'] extends true ? true : false>, O> {
    let base = 'number'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.coerce) base += ' | coerce'
    if (opts?.int) base += ' | int'
    if (opts?.min !== undefined) base += ` | min:${opts.min}`
    if (opts?.max !== undefined) base += ` | max:${opts.max}`
    return new TexType(base, opts?.default) as any
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
  ): WithDefault<TexBoolean<O['optional'] extends true ? true : false>, O> {
    let base = 'boolean'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.coerce) base += ' | coerce'
    return new TexType(base, opts?.default) as any
  }

  /**
   * Defines an email schema (`local@domain`, no whitespace).
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
  ): WithDefault<TexString<O['optional'] extends true ? true : false>, O> {
    let base = 'email'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.trim) base += ' | trim'
    if (opts?.toLowerCase) base += ' | lowercase'
    if (opts?.mask) base += ' | mask'
    return new TexType(base, opts?.default) as any
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
  >(
    opts?: O
  ): WithDefault<TexString<O['optional'] extends true ? true : false>, O> {
    let base = 'uuid'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.version) base += ` | version:${opts.version}`
    return new TexType(base, opts?.default) as any
  }

  /**
   * Defines a CUID (Collision-resistant Unique Identifier) schema.
   */
  cuid<O extends TexStringOptions = TexStringOptions>(
    opts?: O
  ): WithDefault<TexString<O['optional'] extends true ? true : false>, O> {
    let base = 'cuid'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    return new TexType(base, opts?.default) as any
  }

  /**
   * Defines a Credit Card schema validated via the Luhn checksum algorithm.
   */
  creditCard<O extends TexStringOptions = TexStringOptions>(
    opts?: O
  ): WithDefault<TexString<O['optional'] extends true ? true : false>, O> {
    let base = 'creditcard'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.mask) base += ' | mask'
    return new TexType(base, opts?.default) as any
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
  ): WithDefault<TexString<O['optional'] extends true ? true : false>, O> {
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
    return new TexType(base, opts?.default) as any
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
  ): WithDefault<TexArray<T, O['optional'] extends true ? true : false>, O> {
    let resolvedItem = schema as any
    if (
      typeof schema === 'object' &&
      schema !== null &&
      !(schema instanceof TexType) &&
      !(schema instanceof TexEngine)
    ) {
      resolvedItem = this.object(schema as any)
    }

    let base = `array<${fieldRule('[item]', resolvedItem)}>`
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.min !== undefined) base += ` | min:${opts.min}`
    if (opts?.max !== undefined) base += ` | max:${opts.max}`
    if (opts?.dedupe) base += ' | dedupe'
    if (opts?.coerce) base += ' | coerce'
    const res = new TexType(base, opts?.default) as any
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
    values: readonly T[],
    opts?: O
  ): WithDefault<TexEnum<T, O['optional'] extends true ? true : false>, O> {
    let base = `enum:${formatEnumValues(values)}`
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    return new TexType(base, opts?.default) as any
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
    // JSON keeps the type: literal(42) is the number, literal('42') the text
    let base = `literal:${JSON.stringify(value)}`
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
    const items = schemas.map((s) => fieldRule('[option]', s))
    let base = items.join(' || ')
    if (opts?.optional) base = `(${base})?`
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    const res = new TexType(base) as any
    res._options = schemas
    return res as TexUnion<T, O['optional'] extends true ? true : false>
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
  ): WithDefault<TexDate<O['optional'] extends true ? true : false>, O> {
    let base = 'date'
    if (opts?.optional || opts?.default !== undefined) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    if (opts?.coerce) base += ' | coerce'
    if (opts?.minDate) base += ` | minDate:${opts.minDate}`
    if (opts?.maxDate) base += ` | maxDate:${opts.maxDate}`
    return new TexType(base, opts?.default) as any
  }

  /**
   * Defines a dynamic key-value record schema (e.g. `Record<string, T>`).
   */
  record<T, O extends TexBaseOptions = TexBaseOptions>(
    schema: T,
    opts?: O
  ): TexRecord<T, O['optional'] extends true ? true : false> {
    let base = `record<${fieldRule('[value]', schema)}>`
    if (opts?.optional) base += '?'
    if (opts?.nullable) base += ' | nullable'
    if (opts?.nullish) base += ' | nullish'
    const res = new TexType(base) as any
    res._value = schema
    return res as TexRecord<T, O['optional'] extends true ? true : false>
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
   * Defines a discriminated union schema matching one of multiple object variants by a discriminator property.
   *
   * @param discriminator Property name identifying the variant (e.g. `'type'` or `'kind'`)
   * @param variants Array of candidate TexEngine or object schemas
   * @returns Strongly typed `TexDiscriminatedUnionEngine`
   *
   * @example
   * ```ts
   * const ActionSchema = tex.discriminatedUnion('type', [
   *   tex.object({ type: tex.literal('create'), name: tex.string() }),
   *   tex.object({ type: tex.literal('delete'), id: tex.number() })
   * ])
   * ```
   */
  discriminatedUnion<
    Discriminator extends string,
    Variants extends (TexEngine<any> | Record<string, any>)[],
  >(
    discriminator: Discriminator,
    variants: Variants
  ): TexDiscriminatedUnionEngine<Discriminator, Variants> {
    return new TexDiscriminatedUnionEngine(discriminator, variants)
  }

  /**
   * Coercion primitives namespace for query parameters, headers, and form-data.
   */
  get coerce() {
    return {
      number: (opts?: TexNumberOptions) =>
        this.number({ ...opts, coerce: true }),
      boolean: (opts?: TexBooleanOptions) =>
        this.boolean({ ...opts, coerce: true }),
      date: (opts?: TexDateOptions) => this.date({ ...opts, coerce: true }),
      string: (opts?: TexStringOptions) =>
        this.string({ ...opts, coerce: true }),
    }
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
  object<
    T extends Record<string, any>,
    O extends TexObjectOptions = Record<never, never>,
  >(schema: T, opts?: O): ObjectSchema<T, O> {
    checkObjectOptions(opts)
    const compiledSchema: Record<string, string> = {}
    const shape: Record<string, any> = {}
    for (const [key, value] of Object.entries(schema)) {
      // A plain nested shape ({ city: tex.string() }) is an object schema
      shape[key] =
        value !== null &&
        typeof value === 'object' &&
        Object.getPrototypeOf(value) === Object.prototype
          ? this.object(value)
          : value
      compiledSchema[key] = fieldRule(key, shape[key])
    }
    let engine = new TexEngine<any>(compiledSchema, shape, opts?.strict)
    if (opts?.optional || opts?.nullish) engine = engine.optional()
    if (opts?.nullable || opts?.nullish) engine = engine.nullable()
    return engine as any
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
        const raw = value._raw
        // Auto-inject coercion if not already present
        coercedSchema[key] =
          (raw.startsWith('number') ||
            raw.startsWith('boolean') ||
            raw.startsWith('date') ||
            raw.startsWith('array<')) &&
          !raw.includes('coerce')
            ? value._withModifier('coerce')
            : value
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
