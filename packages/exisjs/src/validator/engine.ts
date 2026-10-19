import { compileSchema } from './compile'
import { TexType, type ResolveSchema } from './tex-types'
import { ValidatorError, getNestedValue, formatReceivedValue } from './error'
import {
  RuleError,
  formatPath,
  parseEnumValues,
  parseLiteral,
  refinementMessage,
  ruleBase,
  ruleParts,
} from './rules'
import type { ValidationErrorDescriptor } from './types'

/** Result of `safeParse()`: the data, or the errors instead of a throw. */
export type SafeParseResult<T> =
  | { success: true; data: T; errors?: undefined; error?: undefined }
  | {
      success: false
      data?: undefined
      errors: ValidationErrorDescriptor[]
      error: ValidatorError
    }

function safely<T>(run: () => T): SafeParseResult<T> {
  try {
    return { success: true, data: run() }
  } catch (err) {
    if (err instanceof ValidatorError) {
      return { success: false, errors: err.errors, error: err }
    }
    throw err
  }
}

async function safelyAsync<T>(
  run: () => Promise<T>
): Promise<SafeParseResult<T>> {
  try {
    return { success: true, data: await run() }
  } catch (err) {
    if (err instanceof ValidatorError) {
      return { success: false, errors: err.errors, error: err }
    }
    throw err
  }
}

function engineModifiers(engine: TexEngine<any>): string {
  return (
    (engine._isOptional ? ' | optional' : '') +
    (engine._isNullable ? ' | nullable' : '')
  )
}

/**
 * The rule string for one field of an object schema. Shared by `tex.object`,
 * `tex.array`, `tex.record`, `tex.union` and `extend` so a nested schema
 * keeps its `optional()` / `nullable()` modifiers on every path.
 */
export function fieldRule(key: string, value: unknown): string {
  if (value instanceof TexEngine) {
    return `object<${JSON.stringify(value.getCompiledSchema())}>${engineModifiers(value)}`
  }
  if (value instanceof TexTransformedEngine) {
    return fieldRule(key, value.inner)
  }
  if (value instanceof TexDiscriminatedUnionEngine) return 'object'
  if (value instanceof TexType) return value._raw
  if (typeof value === 'string') return value
  if (value === undefined || value === null) {
    throw new TypeError(
      `tex.object(): field "${key}" has no schema (got ${value})`
    )
  }
  throw new TypeError(
    `tex.object(): field "${key}" is not a field schema (got ${(value as any)?.constructor?.name ?? typeof value}); use tex.object(), tex.array() or a tex.* field`
  )
}

// Error code and expected value for a constraint text ("must be a string")
function describeConstraint(constraint: string): {
  code: string
  expected: string
} {
  if (constraint.startsWith('must be a string')) {
    return { code: 'INVALID_TYPE', expected: 'string' }
  }
  if (constraint.startsWith('must be a number')) {
    return { code: 'INVALID_TYPE', expected: 'number' }
  }
  if (constraint.startsWith('must be a boolean')) {
    return { code: 'INVALID_TYPE', expected: 'boolean' }
  }
  if (constraint.startsWith('must be an array')) {
    return { code: 'INVALID_TYPE', expected: 'array' }
  }
  if (constraint.includes('array must have')) {
    return { code: 'ARRAY_TOO_SHORT', expected: 'array' }
  }
  if (constraint.includes('array exceeds')) {
    return { code: 'ARRAY_TOO_LONG', expected: 'array' }
  }
  if (constraint.startsWith('must be an object')) {
    return { code: 'INVALID_TYPE', expected: 'object' }
  }
  if (constraint.startsWith('must be a valid email')) {
    return { code: 'INVALID_EMAIL', expected: 'valid email address' }
  }
  if (constraint.startsWith('must be one of')) {
    return {
      code: 'INVALID_ENUM_VALUE',
      expected: constraint.replace('must be one of', '').trim(),
    }
  }
  if (
    constraint.startsWith('must be at least') ||
    constraint.startsWith('must be >=')
  ) {
    return { code: 'VALUE_TOO_SMALL', expected: constraint }
  }
  if (
    constraint.startsWith('must be at most') ||
    constraint.startsWith('must be <=')
  ) {
    return { code: 'VALUE_TOO_LARGE', expected: constraint }
  }
  if (constraint.startsWith('must contain a number')) {
    return {
      code: 'PASSWORD_REQUIRES_NUMBER',
      expected: 'must contain at least one digit',
    }
  }
  if (constraint.startsWith('must contain an uppercase')) {
    return {
      code: 'PASSWORD_REQUIRES_UPPERCASE',
      expected: 'must contain at least one uppercase letter',
    }
  }
  if (constraint.startsWith('must contain a lowercase')) {
    return {
      code: 'PASSWORD_REQUIRES_LOWERCASE',
      expected: 'must contain at least one lowercase letter',
    }
  }
  if (constraint.startsWith('must contain a symbol')) {
    return {
      code: 'PASSWORD_REQUIRES_SYMBOL',
      expected: 'must contain at least one symbol',
    }
  }
  return { code: 'VALIDATION_ERROR', expected: constraint }
}

/** Turns a failed rule into a structured error entry */
function describeRuleError(
  err: RuleError,
  data: any
): ValidationErrorDescriptor {
  let path = formatPath(err.path)
  let message: string
  let expected: string | undefined
  let code: string

  switch (err.kind) {
    case 'missing':
      message = 'Expected value, received undefined'
      expected = 'defined'
      code = 'MISSING_REQUIRED_FIELD'
      break
    case 'strict':
      path = path ? `${path}.${err.detail}` : err.detail
      message = 'Unknown field not allowed in strict mode'
      expected = 'undefined (field omitted)'
      code = 'UNRECOGNIZED_KEYS'
      break
    case 'input':
      message = err.detail
      code = 'VALIDATION_ERROR'
      break
    case 'custom':
      message = err.detail
      expected = err.expected
      code = err.code ?? 'CUSTOM_VALIDATION'
      break
    default: {
      message = err.detail.charAt(0).toUpperCase() + err.detail.slice(1)
      if (err.code) {
        code = err.code
        expected = err.expected ?? err.detail
      } else {
        ;({ code, expected } = describeConstraint(err.detail))
      }
    }
  }
  if (path === '') path = 'root'
  const received = formatReceivedValue(getNestedValue(data, path))
  return { path, message, expected, received, code }
}

const MAX_ERRORS = 100

interface ObjectRule {
  fn: (data: any) => boolean
  message?: string | ((data: any) => string)
  path?: string
}

/** Runs object-level `refine()` rules on a validated object */
function objectRulesCheck(rules: ObjectRule[]): (v: any) => any {
  return (v) => {
    for (const r of rules) {
      if (!r.fn(v)) {
        const message =
          typeof r.message === 'function'
            ? r.message(v)
            : r.message || 'Invalid value'
        const err = new RuleError(
          'custom',
          message,
          'CUSTOM_VALIDATION',
          'custom refinement rule'
        )
        if (r.path) err.path.push(...r.path.split('.'))
        throw err
      }
    }
    return v
  }
}

export class TexEngine<T = any> {
  private schema: Record<string, string>
  private rawSchema: Record<string, any>
  private validator: (data: any) => any
  private strict: boolean
  // Query strings and path params: number and boolean fields convert from text
  private _queryValidator?: (data: any) => any

  public readonly _type!: T
  public _isOptional = false
  public _isNullable = false
  // Object-level refine() rules, run once every field is valid
  private _objectRules: ObjectRule[] = []
  /** @internal Read by the rule compiler when this schema is nested */
  _objectCheck?: (v: any) => any

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
    this.validator = compileSchema(schema, strict, rawSchema)
  }

  // Validators per top-level field, built on the first failed parse
  private _fieldValidators?: Map<string, (data: any) => any>

  /**
   * The compiled validator stops at the first problem, which keeps valid
   * requests fast. Once a parse has failed, every field is checked on its
   * own, descending into nested objects, array items and record values, so
   * the response lists every failing value (capped).
   */
  private collectErrors(
    first: unknown,
    data: any,
    query: boolean
  ): ValidationErrorDescriptor[] {
    const firstErrors: ValidationErrorDescriptor[] =
      first instanceof ValidatorError
        ? [...first.errors]
        : [describeRuleError(first as RuleError, data)]
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return firstErrors
    }
    const errors = this._collectFields(data, query)
    // Empty when only an object-level refine() failed
    return errors.length > 0 ? errors : firstErrors
  }

  /** @internal Checks each field on its own; used after a failed parse */
  _collectFields(
    data: Record<string, any>,
    query = false
  ): ValidationErrorDescriptor[] {
    const errors: ValidationErrorDescriptor[] = []
    if (this.strict) {
      for (const key of Object.keys(data)) {
        if (!(key in this.schema)) {
          errors.push({
            path: key,
            message: 'Unknown field not allowed in strict mode',
            expected: 'undefined (field omitted)',
            received: formatReceivedValue(data[key]),
            code: 'UNRECOGNIZED_KEYS',
          })
        }
      }
    }

    this._fieldValidators ??= new Map()
    for (const key of Object.keys(this.schema)) {
      if (errors.length >= MAX_ERRORS) break
      const cacheKey = query ? `?${key}` : key
      let validate = this._fieldValidators.get(cacheKey)
      if (!validate) {
        validate = compileSchema(
          { [key]: this.schema[key] },
          false,
          { [key]: this.rawSchema[key] },
          query
        )
        this._fieldValidators.set(cacheKey, validate)
      }
      const found = errorsOf(validate, data)
      if (found.length === 0) continue
      // The failure is inside a nested object or array: list every part
      const inner = found.some((e) => e.path !== key)
        ? collectInner(this.rawSchema[key], data[key], key)
        : []
      errors.push(...(inner.length > 0 ? inner : found))
    }
    return errors.length > MAX_ERRORS ? errors.slice(0, MAX_ERRORS) : errors
  }

  getCompiledSchema(): Record<string, string> {
    return this.schema
  }

  /** A copy with another shape that keeps strictness and modifiers */
  private derive(
    schema: Record<string, string>,
    rawSchema: Record<string, any>
  ): TexEngine<any> {
    const engine = new TexEngine(
      schema,
      rawSchema,
      this.strict,
      this._isOptional
    )
    engine._isNullable = this._isNullable
    return engine
  }

  /** A copy with the same shape, keeping refine() rules */
  private copy(): TexEngine<any> {
    const engine = this.derive(this.schema, this.rawSchema)
    engine._objectRules = this._objectRules
    engine._objectCheck = this._objectCheck
    return engine
  }

  /** The field may be left out. */
  optional(): TexEngine<T | undefined> & { readonly __isOptional: true } {
    const engine = this.copy()
    engine._isOptional = true
    return engine as any
  }

  /** The field may be `null`. */
  nullable(): TexEngine<T | null> {
    const engine = this.copy()
    engine._isNullable = true
    return engine
  }

  /**
   * A check across fields, run once every field is valid. `path` names the
   * field the error is reported on (default: the object itself).
   *
   * @example
   * ```ts
   * tex.object({ password: tex.string(), confirm: tex.string() })
   *   .refine((d) => d.password === d.confirm, { message: 'Passwords must match', path: 'confirm' })
   * ```
   */
  refine(
    fn: (data: T) => boolean,
    message?:
      | string
      | ((data: T) => string)
      | { message?: string | ((data: T) => string); path?: string }
  ): TexEngine<T> {
    const opts =
      message !== null && typeof message === 'object' ? message : { message }
    const engine = this.copy()
    engine._objectRules = [
      ...this._objectRules,
      { fn, message: opts.message, path: opts.path },
    ]
    engine._objectCheck = objectRulesCheck(engine._objectRules)
    return engine
  }

  /** The field may be left out or be `null`. */
  nullish(): TexEngine<T | null | undefined> & {
    readonly __isOptional: true
  } {
    return this.optional().nullable() as any
  }

  partial(): TexEngine<Partial<T>> {
    const newSchema: Record<string, string> = {}
    const newRaw: Record<string, any> = {}
    for (const [key, val] of Object.entries(this.schema)) {
      // Not `val.includes('?')`: a nested rule contains its children's `?`
      newSchema[key] = `${val} | optional`
      const rawVal = this.rawSchema[key]
      if (rawVal instanceof TexType) {
        // A field left out of a partial update stays unset: a default would
        // overwrite the stored value (PATCH without `tags` -> tags: [])
        const field = rawVal.optional() as unknown as TexType<any>
        field.defaultValue = undefined
        newRaw[key] = field
      } else if (rawVal instanceof TexEngine) {
        newRaw[key] = rawVal.optional()
      } else if (rawVal !== null && typeof rawVal === 'object') {
        newRaw[key] = rawVal
      } else {
        newRaw[key] = newSchema[key]
      }
    }
    return this.derive(newSchema, newRaw)
  }

  extend<E extends Record<string, any>>(
    extension: E
  ): TexEngine<T & ResolveSchema<E>> {
    const newSchema: Record<string, string> = { ...this.schema }
    const newRaw: Record<string, any> = { ...this.rawSchema }
    for (const [key, val] of Object.entries(extension)) {
      newSchema[key] = fieldRule(key, val)
      newRaw[key] = val
    }
    return this.derive(newSchema, newRaw)
  }

  merge<Other>(other: TexEngine<Other>): TexEngine<T & Other> {
    const newSchema = { ...this.schema, ...other.getCompiledSchema() }
    const newRaw = { ...this.rawSchema, ...(other as any).rawSchema }
    return this.derive(newSchema, newRaw)
  }

  transform<Out>(fn: (val: T) => Out): TexTransformedEngine<T, Out> {
    return new TexTransformedEngine<T, Out>(this, fn)
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
    return this.derive(newSchema, newRaw)
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
    return this.derive(newSchema, newRaw)
  }

  /**
   * Validates `data` and returns a new object with the declared fields only.
   * The input is never modified. Throws `ValidatorError` listing every
   * failing field.
   */
  parse(data: any): T {
    const query = Boolean((this as any)._isQueryOrParam)
    const validate = query
      ? (this._queryValidator ??= compileSchema(
          this.schema,
          this.strict,
          this.rawSchema,
          true
        ))
      : this.validator
    try {
      const result = validate(data)
      return this._objectCheck ? this._objectCheck(result) : result
    } catch (err: any) {
      if (!(err instanceof RuleError) && !(err instanceof ValidatorError)) {
        throw err
      }
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

      throw new ValidatorError(this.collectErrors(err, data, query))
    }
  }

  /** Like `parse()`, but returns `{ success, data }` or `{ success, errors }`. */
  safeParse(data: any): SafeParseResult<T> {
    return safely(() => this.parse(data))
  }

  /** Runs `parse()`, then every `refineAsync()` rule, nested ones included. */
  async parseAsync(data: any): Promise<T> {
    const parsed = this.parse(data)
    const errors = await runAsyncRefinements(this, parsed)
    if (errors.length > 0) throw new ValidatorError(errors)
    return parsed
  }

  safeParseAsync(data: any): Promise<SafeParseResult<T>> {
    return safelyAsync(() => this.parseAsync(data))
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
        baseType.startsWith('url') ||
        baseType.startsWith('uuid') ||
        baseType.startsWith('cuid') ||
        baseType.startsWith('password')
      ) {
        field.type = String
      } else if (baseType.startsWith('number')) {
        field.type = Number
      } else if (baseType.startsWith('boolean')) {
        field.type = Boolean
      } else if (baseType.startsWith('date')) {
        field.type = Date
      } else {
        field.type = Object // 'Mixed' essentially or nested
      }

      if (!isOptional) field.required = true
      schemaDef[key] = field
    }
    return schemaDef
  }

  toOpenApi(): Record<string, any> {
    const properties: Record<string, any> = {}
    const required: string[] = []
    for (const [key, rawVal] of Object.entries(this.rawSchema)) {
      const rawDef = this.schema[key] || ''
      const typeStr = rawDef.split('|')[0].trim()
      // A nested rule's text includes its children's modifiers
      const engine =
        rawVal instanceof TexTransformedEngine ? rawVal.inner : rawVal
      const isOptional =
        engine instanceof TexEngine
          ? engine._isOptional || / \| optional$/.test(rawDef)
          : typeStr.endsWith('?') || rawDef.includes('optional')

      let prop: any
      if (rawVal && typeof rawVal.toOpenApi === 'function') {
        prop = rawVal.toOpenApi()
      } else {
        const baseType = ruleBase(rawDef)
        prop = {}
        if (
          baseType.startsWith('string') ||
          baseType.startsWith('uuid') ||
          baseType.startsWith('cuid') ||
          baseType.startsWith('password')
        ) {
          prop.type = 'string'
        } else if (baseType.startsWith('email')) {
          prop.type = 'string'
          prop.format = 'email'
        } else if (baseType.startsWith('url')) {
          prop.type = 'string'
          prop.format = 'uri'
        } else if (baseType.startsWith('number')) {
          prop.type = 'number'
        } else if (baseType.startsWith('boolean')) {
          prop.type = 'boolean'
        } else if (baseType.startsWith('date')) {
          prop.type = 'string'
          prop.format = 'date-time'
        } else if (baseType.startsWith('array<')) {
          prop.type = 'array'
        } else if (baseType.startsWith('enum:')) {
          prop.type = 'string'
          prop.enum = parseEnumValues(baseType.slice(5))
        } else {
          prop.type = 'object'
        }
      }

      properties[key] = prop
      if (!isOptional) required.push(key)
    }
    const result: any = { type: 'object', properties }
    if (required.length > 0) result.required = required
    if (this.strict) result.additionalProperties = false
    return result
  }
}

export class TexTransformedEngine<In, Out> {
  public readonly _type!: Out

  constructor(
    public readonly inner: TexEngine<In>,
    public readonly transformFn: (val: In) => Out
  ) {}

  parse(data: any): Out {
    const validated = this.inner.parse(data)
    return this.transformFn(validated)
  }

  safeParse(data: any): SafeParseResult<Out> {
    return safely(() => this.parse(data))
  }

  async parseAsync(data: any): Promise<Out> {
    const validated = await this.inner.parseAsync(data)
    return this.transformFn(validated)
  }

  safeParseAsync(data: any): Promise<SafeParseResult<Out>> {
    return safelyAsync(() => this.parseAsync(data))
  }

  toOpenApi(): Record<string, any> {
    return this.inner.toOpenApi()
  }
}

export class TexDiscriminatedUnionEngine<
  Discriminator extends string,
  Variants extends (TexEngine<any> | Record<string, any>)[],
> {
  public readonly _type!: Variants[number]['_type']
  private engines: TexEngine<any>[]
  // The discriminator value(s) each variant accepts
  private tags: (string | number | boolean)[][]

  constructor(
    public readonly discriminator: Discriminator,
    public readonly variants: Variants
  ) {
    this.engines = variants.map((v) =>
      v instanceof TexEngine
        ? v
        : new TexEngine(
            Object.fromEntries(
              Object.entries(v).map(([k, val]) => [k, fieldRule(k, val)])
            ),
            v
          )
    )
    this.tags = this.engines.map((engine) => {
      const rule = engine.getCompiledSchema()[discriminator]
      if (rule === undefined) return []
      const base = ruleBase(rule)
      if (base.startsWith('literal:')) return [parseLiteral(base.slice(8))]
      if (base.startsWith('enum:')) return parseEnumValues(base.slice(5))
      return []
    })
  }

  /** The variant whose discriminator matches `data`, if any */
  variantFor(data: any): TexEngine<any> | undefined {
    if (!data || typeof data !== 'object') return undefined
    const tag = data[this.discriminator]
    const i = this.tags.findIndex((tags) => tags.includes(tag))
    return i === -1 ? undefined : this.engines[i]
  }

  private noMatch(data: any): ValidatorError {
    if (!data || typeof data !== 'object') {
      return new ValidatorError([
        {
          path: '',
          message: 'Expected an object for discriminated union payload',
          expected: 'object',
          received: formatReceivedValue(data),
          code: 'INVALID_TYPE',
        },
      ])
    }
    const tagValue = data[this.discriminator]
    if (tagValue === undefined) {
      return new ValidatorError([
        {
          path: this.discriminator,
          message: `Missing discriminator field '${this.discriminator}'`,
          expected: 'string | number',
          received: 'undefined',
          code: 'MISSING_DISCRIMINATOR',
        },
      ])
    }
    return new ValidatorError([
      {
        path: this.discriminator,
        message: `Invalid discriminator value '${tagValue}' for field '${this.discriminator}'`,
        expected: `one of ${JSON.stringify(this.tags.flat())}`,
        received: formatReceivedValue(tagValue),
        code: 'INVALID_DISCRIMINATOR_VALUE',
      },
    ])
  }

  parse(data: any): Variants[number]['_type'] {
    const engine = this.variantFor(data)
    if (!engine) throw this.noMatch(data)
    return engine.parse(data)
  }

  safeParse(data: any): SafeParseResult<Variants[number]['_type']> {
    return safely(() => this.parse(data))
  }

  async parseAsync(data: any): Promise<Variants[number]['_type']> {
    const engine = this.variantFor(data)
    if (!engine) throw this.noMatch(data)
    return engine.parseAsync(data)
  }

  safeParseAsync(
    data: any
  ): Promise<SafeParseResult<Variants[number]['_type']>> {
    return safelyAsync(() => this.parseAsync(data))
  }

  toOpenApi(): Record<string, any> {
    const oneOf = this.engines.map((e) => e.toOpenApi())
    return {
      oneOf,
      discriminator: {
        propertyName: this.discriminator,
      },
    }
  }
}

// ─── Error collection ────────────────────────────────────────────────────────

function errorsOf(
  validate: (data: any) => any,
  data: any
): ValidationErrorDescriptor[] {
  try {
    validate(data)
    return []
  } catch (err) {
    if (err instanceof ValidatorError) return [...err.errors]
    if (err instanceof RuleError) return [describeRuleError(err, data)]
    throw err
  }
}

// Validates one item of an array (or one value of a record) at a time
const itemValidators = new WeakMap<object, (data: any) => any>()

function itemValidator(
  container: TexType,
  isArray: boolean
): (data: any) => any {
  let validate = itemValidators.get(container)
  if (!validate) {
    const item = isArray ? (container as any)._item : (container as any)._value
    const coerce = isArray && ruleParts(container._raw).includes('coerce')
    const rule = isArray
      ? `array<${fieldRule('[item]', item)}>${coerce ? ' | coerce' : ''}`
      : `record<${fieldRule('[value]', item)}>`
    validate = compileSchema({ v: rule }, false, {
      v: isArray ? { _item: item } : { _value: item },
    })
    itemValidators.set(container, validate)
  }
  return validate
}

function relabel(
  errors: ValidationErrorDescriptor[],
  from: string,
  to: string
): ValidationErrorDescriptor[] {
  return errors.map((e) => ({
    ...e,
    path: e.path.startsWith(from) ? to + e.path.slice(from.length) : to,
  }))
}

/** Every failing value inside a nested object, array or record at `path` */
function collectInner(
  raw: any,
  value: any,
  path: string
): ValidationErrorDescriptor[] {
  if (value === null || typeof value !== 'object') return []
  const engine =
    raw instanceof TexEngine
      ? raw
      : raw instanceof TexTransformedEngine
        ? raw.inner
        : undefined
  if (engine) {
    if (Array.isArray(value)) return []
    return engine._collectFields(value).map((e) => ({
      ...e,
      path: e.path === 'root' ? path : `${path}.${e.path}`,
    }))
  }
  if (!(raw instanceof TexType)) return []
  const isArray = Array.isArray(value)
  const item = isArray ? (raw as any)._item : (raw as any)._value
  if (item === undefined) return []

  const validate = itemValidator(raw, isArray)
  const keys: (string | number)[] = isArray
    ? value.map((_: unknown, i: number) => i)
    : Object.keys(value).filter((k) => k !== '__proto__' && k !== 'constructor')
  const out: ValidationErrorDescriptor[] = []
  for (const k of keys) {
    if (out.length >= MAX_ERRORS) break
    const single = isArray ? [value[k as number]] : { [k]: value[k] }
    const at = isArray ? `v[0]` : `v.${k}`
    const itemPath = isArray ? `${path}[${k}]` : `${path}.${k}`
    const found = errorsOf(validate, { v: single })
    if (found.length === 0) continue
    const nested = found.some((e) => e.path !== at)
      ? collectInner(item, value[k], itemPath)
      : []
    out.push(...(nested.length > 0 ? nested : relabel(found, at, itemPath)))
  }
  return out
}

// ─── Async refinements ───────────────────────────────────────────────────────
// Walks the parsed value next to its schema, so `refineAsync()` rules run at
// every depth: nested objects, array items and record values.

function joinPath(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`
  return path ? `${path}.${key}` : key
}

function collectAsync(
  node: any,
  value: any,
  path: string,
  tasks: Promise<ValidationErrorDescriptor | null>[]
): void {
  if (value === undefined || value === null) return
  if (node instanceof TexEngine) {
    if (typeof value !== 'object') return
    const raw = (node as any).rawSchema as Record<string, any>
    for (const key of Object.keys(raw)) {
      collectAsync(raw[key], value[key], joinPath(path, key), tasks)
    }
    return
  }
  if (node instanceof TexDiscriminatedUnionEngine) {
    const engine = node.variantFor(value)
    if (engine) collectAsync(engine, value, path, tasks)
    return
  }
  if (!(node instanceof TexType)) return

  for (const r of node.refinements) {
    if (!r.async) continue
    tasks.push(
      Promise.resolve(r.fn(value)).then((ok) =>
        ok
          ? null
          : {
              path: path || 'root',
              message: refinementMessage(r, value),
              expected: 'custom async refinement rule',
              received: formatReceivedValue(value),
              code: 'CUSTOM_VALIDATION',
            }
      )
    )
  }
  const item = (node as any)._item
  if (item && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectAsync(item, value[i], joinPath(path, i), tasks)
    }
  }
  const recordValue = (node as any)._value
  if (recordValue && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      collectAsync(recordValue, value[key], joinPath(path, key), tasks)
    }
  }
}

async function runAsyncRefinements(
  engine: TexEngine<any>,
  parsed: any
): Promise<ValidationErrorDescriptor[]> {
  const tasks: Promise<ValidationErrorDescriptor | null>[] = []
  collectAsync(engine, parsed, '', tasks)
  if (tasks.length === 0) return []
  const results = await Promise.all(tasks)
  return results.filter((e): e is ValidationErrorDescriptor => e !== null)
}
