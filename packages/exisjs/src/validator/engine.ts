import { compileSchema } from './compile'
import { TexType, type ResolveSchema } from './tex-types'
import { ValidatorError, getNestedValue, formatReceivedValue } from './error'
import type { ValidationErrorDescriptor } from './types'

export class TexEngine<T = any> {
  private schema: Record<string, string>
  private rawSchema: Record<string, any>
  private validator: (data: any) => any
  private strict: boolean

  public readonly _type!: T
  public _isOptional = false
  // Per-field work list, built on first parse so builder mutations made
  // before then (refine, sanitize) are included
  private _plan?: ParsePlan

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
    this.validator = compileSchema(schema, strict)
  }

  getCompiledSchema(): Record<string, string> {
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

  extend<E extends Record<string, any>>(
    extension: E
  ): TexEngine<T & ResolveSchema<E>> {
    const newSchema: Record<string, string> = { ...this.schema }
    const newRaw: Record<string, any> = { ...this.rawSchema }
    for (const [key, val] of Object.entries(extension)) {
      if (val instanceof TexEngine) {
        newSchema[key] = `object<${JSON.stringify(val.getCompiledSchema())}>`
        newRaw[key] = val
      } else if (val instanceof TexType) {
        newSchema[key] = val._raw
        newRaw[key] = val
      } else {
        newSchema[key] = val as string
        newRaw[key] = val
      }
    }
    return new TexEngine(
      newSchema,
      newRaw,
      this.strict,
      this._isOptional
    ) as any
  }

  merge<Other>(other: TexEngine<Other>): TexEngine<T & Other> {
    const newSchema = { ...this.schema, ...other.getCompiledSchema() }
    const newRaw = { ...this.rawSchema, ...(other as any).rawSchema }
    return new TexEngine(
      newSchema,
      newRaw,
      this.strict,
      this._isOptional
    ) as any
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
    const plan =
      this._plan || (this._plan = splitPlan(buildPlan(this.rawSchema)))
    const coerceScalars = Boolean((this as any)._isQueryOrParam)

    // 1. Defaults, empty-string handling, coercion and sanitizers. Only
    // fields that need any of it are visited.
    if (data && typeof data === 'object') {
      const prep = coerceScalars ? plan.prepQuery : plan.prep
      for (const f of prep) prepareField(data, f, coerceScalars)
    }

    // 2. Type validation (compiled once per schema)
    let parsedData: any
    try {
      parsedData = this.validator(data)
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

    if (parsedData && typeof parsedData === 'object' && plan.post.length > 0) {
      const errors: ValidationErrorDescriptor[] = []
      for (const f of plan.post) {
        const key = f.key

        // Preserve Date objects and ensure defaults are applied
        if (
          parsedData[key] === undefined &&
          f.tex?.defaultValue !== undefined
        ) {
          parsedData[key] = resolveDefault(f.tex.defaultValue)
        }
        if (f.isDate && data && data[key] instanceof Date) {
          parsedData[key] = data[key]
        }

        // 3. Post-validation synchronous refinements
        if (f.hasRefinements && parsedData[key] !== undefined) {
          if (!(parsedData[key] === null && f.isNullable)) {
            runSyncRefinements(f, parsedData[key], errors)
          }
        }
      }

      if (errors.length > 0) throw new ValidatorError(errors)

      // 4. Post-validation field transformations
      for (const f of plan.post) {
        if (f.tex && f.tex.transformations.length > 0) {
          const key = f.key
          if (parsedData[key] !== undefined) {
            for (const t of f.tex.transformations) {
              parsedData[key] = t(parsedData[key])
            }
          }
        }
      }
    }

    return parsedData
  }

  async parseAsync(data: any): Promise<T> {
    const parsed = this.parse(data) // Handles sync sanitizers + rust + sync refine + transformations

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
      const isOptional =
        typeStr.endsWith('?') ||
        rawDef.includes('optional') ||
        (rawVal as any)?._isOptional

      let prop: any
      if (rawVal && typeof rawVal.toOpenApi === 'function') {
        prop = rawVal.toOpenApi()
      } else {
        const baseType = typeStr.replace('?', '')
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
          prop.enum = baseType.replace('enum:', '').split(',')
        } else {
          prop.type = 'object'
        }
      }

      properties[key] = prop
      if (!isOptional) required.push(key)
    }
    const result: any = { type: 'object', properties }
    if (required.length > 0) result.required = required
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

  async parseAsync(data: any): Promise<Out> {
    const validated = await this.inner.parseAsync(data)
    return this.transformFn(validated)
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

  constructor(
    public readonly discriminator: Discriminator,
    public readonly variants: Variants
  ) {
    this.engines = variants.map((v) =>
      v instanceof TexEngine
        ? v
        : new TexEngine(
            Object.fromEntries(
              Object.entries(v).map(([k, val]) => [
                k,
                val instanceof TexType ? val._raw : String(val),
              ])
            ),
            v
          )
    )
  }

  parse(data: any): Variants[number]['_type'] {
    if (!data || typeof data !== 'object') {
      throw new ValidatorError([
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
      throw new ValidatorError([
        {
          path: this.discriminator,
          message: `Missing discriminator field '${this.discriminator}'`,
          expected: 'string | number',
          received: 'undefined',
          code: 'MISSING_DISCRIMINATOR',
        },
      ])
    }

    for (const engine of this.engines) {
      const rawField = (engine as any).rawSchema?.[this.discriminator]

      let matches = false
      if (rawField instanceof TexType) {
        if (rawField._raw.startsWith('literal:')) {
          const literalVal = rawField._raw
            .replace('literal:', '')
            .split('|')[0]
            .trim()
          if (String(tagValue) === literalVal) matches = true
        } else if (rawField._raw.startsWith('enum:')) {
          const allowed = rawField._raw
            .replace('enum:', '')
            .split('|')[0]
            .trim()
            .split(',')
          if (allowed.includes(String(tagValue))) matches = true
        }
      } else if (
        typeof rawField === 'string' &&
        rawField.startsWith('literal:')
      ) {
        const literalVal = rawField.replace('literal:', '').split('|')[0].trim()
        if (String(tagValue) === literalVal) matches = true
      }

      if (matches) {
        return engine.parse(data)
      }
    }

    throw new ValidatorError([
      {
        path: this.discriminator,
        message: `Invalid discriminator value '${tagValue}' for field '${this.discriminator}'`,
        expected: 'one of matching variant discriminators',
        received: formatReceivedValue(tagValue),
        code: 'INVALID_DISCRIMINATOR_VALUE',
      },
    ])
  }

  async parseAsync(data: any): Promise<Variants[number]['_type']> {
    if (!data || typeof data !== 'object') {
      return this.parse(data)
    }

    const tagValue = data[this.discriminator]
    if (tagValue === undefined) {
      return this.parse(data)
    }

    for (const engine of this.engines) {
      const rawField = (engine as any).rawSchema?.[this.discriminator]
      let matches = false
      if (rawField instanceof TexType) {
        if (rawField._raw.startsWith('literal:')) {
          const literalVal = rawField._raw
            .replace('literal:', '')
            .split('|')[0]
            .trim()
          if (String(tagValue) === literalVal) matches = true
        } else if (rawField._raw.startsWith('enum:')) {
          const allowed = rawField._raw
            .replace('enum:', '')
            .split('|')[0]
            .trim()
            .split(',')
          if (allowed.includes(String(tagValue))) matches = true
        }
      }

      if (matches) {
        return engine.parseAsync(data)
      }
    }

    return this.parse(data)
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

// ─── Parse plan ──────────────────────────────────────────────────────────────
// Everything derivable from a field's rule string is decided once here, so
// parse() does no string scanning per request.

interface FieldPlan {
  key: string
  tex: TexType | null
  emptyString: 'keep' | 'null' | 'delete'
  isDate: boolean
  dateCoerce: boolean
  minDate?: string
  maxDate?: string
  stringCoerce: boolean
  number: 'no' | 'coerce' | 'query'
  boolean: 'no' | 'coerce' | 'query'
  array: 'no' | 'number' | 'boolean' | 'other'
  item: TexType | null
  isNullable: boolean
  hasRefinements: boolean
}

interface ParsePlan {
  /** Fields needing pre-validation work for body parsing */
  prep: FieldPlan[]
  /** Same, when the engine validates query/params (scalar coercion on) */
  prepQuery: FieldPlan[]
  /** Fields with defaults, dates, refinements or transformations */
  post: FieldPlan[]
}

function needsPrep(f: FieldPlan, coerceScalars: boolean): boolean {
  return (
    f.tex?.defaultValue !== undefined ||
    f.emptyString !== 'keep' ||
    f.isDate ||
    f.stringCoerce ||
    f.number === 'coerce' ||
    f.boolean === 'coerce' ||
    (coerceScalars && (f.number === 'query' || f.boolean === 'query')) ||
    f.array !== 'no' ||
    (f.tex !== null && f.tex.sanitizers.length > 0) ||
    (f.item !== null && f.item.sanitizers.length > 0)
  )
}

function splitPlan(plan: FieldPlan[]): ParsePlan {
  return {
    prep: plan.filter((f) => needsPrep(f, false)),
    prepQuery: plan.filter((f) => needsPrep(f, true)),
    post: plan.filter(
      (f) =>
        f.tex?.defaultValue !== undefined ||
        f.isDate ||
        f.hasRefinements ||
        (f.tex !== null && f.tex.transformations.length > 0)
    ),
  }
}

function scalarMode(
  plain: boolean,
  raw: string,
  type: string,
  coerce: boolean
): 'no' | 'coerce' | 'query' {
  if (!plain || !raw.startsWith(type)) return 'no'
  return coerce ? 'coerce' : 'query'
}

function arrayMode(
  plain: boolean,
  raw: string,
  coerce: boolean
): FieldPlan['array'] {
  if (!plain || !coerce || !raw.startsWith('array<')) return 'no'
  if (raw.startsWith('array<number')) return 'number'
  if (raw.startsWith('array<boolean')) return 'boolean'
  return 'other'
}

function buildPlan(rawSchema: Record<string, any>): FieldPlan[] {
  const plan: FieldPlan[] = []
  for (const key of Object.keys(rawSchema)) {
    const val = rawSchema[key]
    const tex = val instanceof TexType ? val : null
    const raw = tex ? tex._raw : String(val)
    // Unions coerce per alternative inside the compiled rule
    const plain = tex !== null && !raw.includes('||')
    const coerce = raw.includes('coerce')
    const nullable = raw.includes('nullable')
    const nullish = raw.includes('nullish')
    const optional = raw.includes('optional')

    let emptyString: FieldPlan['emptyString'] = 'keep'
    if (
      optional ||
      nullable ||
      nullish ||
      raw.includes('?') ||
      val?._isOptional
    ) {
      emptyString = nullable && !optional && !nullish ? 'null' : 'delete'
    }

    const item = val?._item instanceof TexType ? (val._item as TexType) : null
    const isDate = plain && raw.startsWith('date')
    plan.push({
      key,
      tex,
      emptyString,
      isDate,
      dateCoerce: isDate && coerce,
      minDate: isDate ? raw.match(/minDate:([^\s|]+)/)?.[1] : undefined,
      maxDate: isDate ? raw.match(/maxDate:([^\s|]+)/)?.[1] : undefined,
      stringCoerce: plain && coerce && raw.startsWith('string'),
      number: scalarMode(plain, raw, 'number', coerce),
      boolean: scalarMode(plain, raw, 'boolean', coerce),
      array: arrayMode(plain, raw, coerce),
      item,
      isNullable: tex !== null && (nullable || nullish),
      hasRefinements:
        (tex !== null && tex.refinements.length > 0) ||
        (item !== null && item.refinements.length > 0),
    })
  }
  return plan
}

function resolveDefault(defaultValue: any): any {
  return typeof defaultValue === 'function' ? defaultValue() : defaultValue
}

function fieldError(
  key: string,
  value: any,
  message: string,
  expected: string,
  code: string
): never {
  throw new ValidatorError([
    {
      path: key,
      message,
      expected,
      received: formatReceivedValue(value),
      code,
    },
  ])
}

function prepareDate(key: string, value: any, f: FieldPlan): any {
  if (
    f.dateCoerce &&
    (typeof value === 'string' || typeof value === 'number')
  ) {
    const d = new Date(value)
    if (isNaN(d.getTime())) {
      fieldError(
        key,
        value,
        'Must be a valid date',
        'valid date string or timestamp',
        'INVALID_DATE'
      )
    }
    value = d
  }
  if (
    !(value instanceof Date) &&
    typeof value !== 'string' &&
    typeof value !== 'number'
  ) {
    fieldError(
      key,
      value,
      'Must be a valid date',
      'valid date or date string',
      'INVALID_TYPE'
    )
  }
  if (value instanceof Date && isNaN(value.getTime())) {
    fieldError(
      key,
      value,
      'Must be a valid date',
      'valid date string or timestamp',
      'INVALID_DATE'
    )
  }
  const time = new Date(value).getTime()
  if (f.minDate && time < new Date(f.minDate).getTime()) {
    fieldError(
      key,
      value,
      `Date must be after ${f.minDate}`,
      `>= ${f.minDate}`,
      'DATE_TOO_EARLY'
    )
  }
  if (f.maxDate && time > new Date(f.maxDate).getTime()) {
    fieldError(
      key,
      value,
      `Date must be before ${f.maxDate}`,
      `<= ${f.maxDate}`,
      'DATE_TOO_LATE'
    )
  }
  return value
}

function prepareField(data: any, f: FieldPlan, coerceScalars: boolean): void {
  const key = f.key
  const tex = f.tex

  // Apply default value / lazy factory function if field is omitted
  if (data[key] === undefined && tex?.defaultValue !== undefined) {
    data[key] = resolveDefault(tex.defaultValue)
  }

  if (
    f.emptyString !== 'keep' &&
    typeof data[key] === 'string' &&
    data[key].trim() === ''
  ) {
    if (f.emptyString === 'null') {
      data[key] = null
    } else {
      delete data[key]
      if (tex?.defaultValue !== undefined) {
        data[key] = resolveDefault(tex.defaultValue)
      }
    }
  }

  let value = data[key]
  if (value === undefined || value === null) return

  if (f.isDate) data[key] = value = prepareDate(key, value, f)

  if (f.stringCoerce && typeof value !== 'string') {
    data[key] = value = String(value)
  }

  if (
    (f.number === 'coerce' || (f.number === 'query' && coerceScalars)) &&
    typeof value === 'string' &&
    value.trim() !== ''
  ) {
    const n = Number(value)
    if (isNaN(n))
      fieldError(key, value, 'Must be a number', 'number', 'INVALID_TYPE')
    data[key] = value = n
  }

  if (
    (f.boolean === 'coerce' || (f.boolean === 'query' && coerceScalars)) &&
    typeof value === 'string' &&
    value.trim() !== ''
  ) {
    const lower = value.toLowerCase().trim()
    if (lower === 'true' || lower === '1') data[key] = value = true
    else if (lower === 'false' || lower === '0') data[key] = value = false
    else {
      fieldError(
        key,
        value,
        'Must be a boolean',
        'boolean (true or false)',
        'INVALID_TYPE'
      )
    }
  }

  if (f.array !== 'no') data[key] = coerceArray(value, f.array)

  if (tex !== null && tex.sanitizers.length > 0) {
    for (const s of tex.sanitizers) {
      if (data[key] === undefined || data[key] === null) break
      data[key] = s(data[key])
    }
  }

  const item = f.item
  if (item !== null && item.sanitizers.length > 0 && Array.isArray(data[key])) {
    const arr = data[key]
    for (let i = 0; i < arr.length; i++) {
      for (const s of item.sanitizers) {
        if (arr[i] === undefined || arr[i] === null) break
        arr[i] = s(arr[i])
      }
    }
  }
}

function coerceItem(item: any, kind: FieldPlan['array']): any {
  if (typeof item !== 'string') return item
  if (kind === 'number') {
    const n = Number(item)
    return isNaN(n) ? item : n
  }
  if (kind === 'boolean') {
    const lower = item.toLowerCase()
    if (lower === 'true') return true
    if (lower === 'false') return false
  }
  return item
}

function coerceArray(value: any, kind: FieldPlan['array']): any {
  if (!Array.isArray(value)) {
    if (typeof value !== 'string') return [value]
    const parts = value.includes(',')
      ? value.split(',').map((s: string) => s.trim())
      : [value]
    return kind === 'other' ? parts : parts.map((p) => coerceItem(p, kind))
  }
  return kind === 'other' ? value : value.map((v) => coerceItem(v, kind))
}

function refinementMessage(
  r: { message?: string | ((val: any) => string) },
  value: any
): string {
  return typeof r.message === 'function'
    ? r.message(value)
    : r.message || 'Invalid value'
}

function runSyncRefinements(
  f: FieldPlan,
  value: any,
  errors: ValidationErrorDescriptor[]
): void {
  if (f.tex !== null) {
    for (const r of f.tex.refinements) {
      if (!r.async && !r.fn(value)) {
        errors.push({
          path: f.key,
          message: refinementMessage(r, value),
          expected: 'custom refinement rule',
          received: formatReceivedValue(value),
          code: 'CUSTOM_VALIDATION',
        })
      }
    }
  }
  const item = f.item
  if (item === null || item.refinements.length === 0 || !Array.isArray(value)) {
    return
  }
  const itemNullable =
    item._raw.includes('nullable') || item._raw.includes('nullish')
  for (let i = 0; i < value.length; i++) {
    if (value[i] === null && itemNullable) continue
    for (const r of item.refinements) {
      if (!r.async && !r.fn(value[i])) {
        errors.push({
          path: `${f.key}[${i}]`,
          message: refinementMessage(r, value[i]),
          expected: 'custom refinement rule',
          received: formatReceivedValue(value[i]),
          code: 'CUSTOM_VALIDATION',
        })
      }
    }
  }
}
