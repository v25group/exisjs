import { TexValidator } from '@exisjs/rs'
import { TexType, type ResolveSchema } from './tex-types'
import { ValidatorError, getNestedValue, formatReceivedValue } from './error'
import type { ValidationErrorDescriptor } from './types'

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

          if (val instanceof TexType && val._raw.startsWith('string')) {
            if (val._raw.includes('coerce') && typeof data[key] !== 'string') {
              data[key] = String(data[key])
            }
          }

          if (val instanceof TexType && val._raw.startsWith('number')) {
            if (val._raw.includes('coerce') || (this as any)._isQueryOrParam) {
              if (typeof data[key] === 'string' && data[key].trim() !== '') {
                const n = Number(data[key])
                if (!isNaN(n)) {
                  data[key] = n
                } else {
                  throw new ValidatorError([
                    {
                      path: key,
                      message: 'Must be a number',
                      expected: 'number',
                      received: formatReceivedValue(data[key]),
                      code: 'INVALID_TYPE',
                    },
                  ])
                }
              }
            }
          }

          if (val instanceof TexType && val._raw.startsWith('boolean')) {
            if (val._raw.includes('coerce') || (this as any)._isQueryOrParam) {
              if (typeof data[key] === 'string' && data[key].trim() !== '') {
                const lower = data[key].toLowerCase().trim()
                if (lower === 'true' || lower === '1') {
                  data[key] = true
                } else if (lower === 'false' || lower === '0') {
                  data[key] = false
                } else {
                  throw new ValidatorError([
                    {
                      path: key,
                      message: 'Must be a boolean',
                      expected: 'boolean (true or false)',
                      received: formatReceivedValue(data[key]),
                      code: 'INVALID_TYPE',
                    },
                  ])
                }
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

    // 4. Post-validation field transformations
    if (parsedData && typeof parsedData === 'object') {
      for (const [key, val] of Object.entries(this.rawSchema)) {
        if (parsedData[key] !== undefined) {
          if (val instanceof TexType && val.transformations.length > 0) {
            for (const t of val.transformations) {
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
