export type ValidationError = { path: string; message: string }

export class ValidatorError extends Error {
  constructor(public errors: ValidationError[]) {
    super(
      'Validation Error: ' +
        errors.map((e) => `${e.path}: ${e.message}`).join(', ')
    )
    this.name = 'ValidatorError'
  }
}

export abstract class ValidatorType<T> {
  protected isOptional = false
  protected _hasDefault = false
  protected defaultValue?: T | (() => T)
  protected _isUnique = false
  protected _index = false

  optional(): ValidatorType<T | undefined> {
    this.isOptional = true
    return this as never
  }

  default(val: T | (() => T)): ValidatorType<T> {
    this.isOptional = true
    this._hasDefault = true
    this.defaultValue = val
    return this as never
  }

  unique(): this {
    this._isUnique = true
    return this
  }

  index(): this {
    this._index = true
    return this
  }

  refine(
    check: (val: T) => boolean,
    message: string | ((val: T) => string) = 'Invalid value'
  ): ValidatorType<T> {
    return new RefineValidator<T>(this, check, message) as never
  }

  protected _sanitizers: ((val: any) => any)[] = []

  sanitize(...sanitizers: ((val: T) => T)[]): this {
    this._sanitizers.push(...sanitizers)
    return this
  }

  transform<U>(fn: (val: T) => U): ValidatorType<U> {
    return new TransformValidator<T, U>(this, fn) as never
  }

  or<U>(other: ValidatorType<U>): ValidatorType<T | U> {
    return new UnionValidator([this, other]) as never
  }

  abstract toOpenApi(): Record<string, unknown>

  /**
   * Converts this validator into a Mongoose-compatible schema field definition.
   * Override in subclasses for specific type mappings.
   */
  toMongoField(): Record<string, unknown> {
    const field: Record<string, unknown> = { type: 'Mixed' as any }
    if (!this.isOptional) field.required = true
    if (this._hasDefault) {
      field.default =
        typeof this.defaultValue === 'function'
          ? this.defaultValue
          : this.defaultValue
    }
    if (this._isUnique) field.unique = true
    if (this._index) field.index = true
    return field
  }

  abstract _validate(
    value: unknown,
    path: string
  ): { success: true; data: T } | { success: false; errors: ValidationError[] }

  async _validateAsync(
    value: unknown,
    path: string
  ): Promise<
    { success: true; data: T } | { success: false; errors: ValidationError[] }
  > {
    return this._validate(value, path)
  }

  validate(
    value: unknown,
    path = ''
  ):
    { success: true; data: T } | { success: false; errors: ValidationError[] } {
    if (this._hasDefault && value === undefined) {
      const def =
        typeof this.defaultValue === 'function'
          ? (this.defaultValue as () => T)()
          : this.defaultValue
      return { success: true, data: def as T }
    }
    return this._validate(value, path)
  }

  async validateAsync(
    value: unknown,
    path = ''
  ): Promise<
    { success: true; data: T } | { success: false; errors: ValidationError[] }
  > {
    if (this._hasDefault && value === undefined) {
      const def =
        typeof this.defaultValue === 'function'
          ? (this.defaultValue as () => T)()
          : this.defaultValue
      return { success: true, data: def as T }
    }
    return this._validateAsync(value, path)
  }

  refineAsync(
    check: (val: T) => Promise<boolean>,
    message: string | ((val: T) => string) = 'Invalid value'
  ): ValidatorType<T> {
    return new AsyncRefineValidator<T>(this, check, message) as never
  }

  parse(value: unknown): T {
    const result = this.validate(value, '')
    if (!result.success) throw new ValidatorError(result.errors)
    return result.data
  }

  async parseAsync(value: unknown): Promise<T> {
    const result = await this.validateAsync(value, '')
    if (!result.success) throw new ValidatorError(result.errors)
    return result.data
  }
}

export class RefineValidator<T> extends ValidatorType<T> {
  constructor(
    private base: ValidatorType<T>,
    private check: (val: T) => boolean,
    private message: string | ((val: T) => string)
  ) {
    super()
  }
  toOpenApi(): Record<string, unknown> {
    return this.base.toOpenApi()
  }
  _validate(
    value: unknown,
    path: string
  ):
    { success: true; data: T } | { success: false; errors: ValidationError[] } {
    const res = this.base._validate(value, path)
    if (!res.success) return res
    if (res.data !== undefined) {
      if (!this.check(res.data)) {
        const msg =
          typeof this.message === 'function'
            ? this.message(res.data)
            : this.message
        return { success: false, errors: [{ path, message: msg }] }
      }
    }
    return res
  }
}

export class TransformValidator<T, U> extends ValidatorType<U> {
  constructor(
    private base: ValidatorType<T>,
    private fn: (val: T) => U
  ) {
    super()
  }
  toOpenApi(): Record<string, unknown> {
    return this.base.toOpenApi()
  }
  _validate(
    value: unknown,
    path: string
  ):
    { success: true; data: U } | { success: false; errors: ValidationError[] } {
    const res = this.base._validate(value, path)
    if (!res.success) return res
    if (res.data !== undefined) {
      try {
        const transformed = this.fn(res.data)
        return { success: true, data: transformed }
      } catch (err: unknown) {
        return {
          success: false,
          errors: [
            {
              path,
              message: err instanceof Error ? err.message : 'Transform failed',
            },
          ],
        }
      }
    }
    return { success: true, data: res.data as never }
  }
}

export class AsyncRefineValidator<T> extends ValidatorType<T> {
  constructor(
    private base: ValidatorType<T>,
    private check: (val: T) => Promise<boolean>,
    private message: string | ((val: T) => string)
  ) {
    super()
  }
  toOpenApi(): Record<string, unknown> {
    return this.base.toOpenApi()
  }
  _validate(
    _value: unknown,
    _path: string
  ):
    { success: true; data: T } | { success: false; errors: ValidationError[] } {
    throw new Error('Async validation requires parseAsync() to be used')
  }
  async _validateAsync(
    value: unknown,
    path: string
  ): Promise<
    { success: true; data: T } | { success: false; errors: ValidationError[] }
  > {
    const res = await this.base.validateAsync(value, path)
    if (!res.success) return res
    if (res.data !== undefined) {
      if (!(await this.check(res.data))) {
        const msg =
          typeof this.message === 'function'
            ? this.message(res.data)
            : this.message
        return { success: false, errors: [{ path, message: msg }] }
      }
    }
    return res
  }
}

export class StringValidator extends ValidatorType<string> {
  private minLen?: number
  private minMsg?: string
  private maxLen?: number
  private maxMsg?: string
  private isEmail?: boolean
  private emailMsg?: string
  private regexPattern?: RegExp
  private regexMsg?: string

  min(len: number, message?: string) {
    this.minLen = len
    this.minMsg = message
    return this
  }
  max(len: number, message?: string) {
    this.maxLen = len
    this.maxMsg = message
    return this
  }
  email(message?: string) {
    this.isEmail = true
    this.emailMsg = message
    return this
  }

  regex(pattern: RegExp, message?: string) {
    this.regexPattern = pattern
    this.regexMsg = message
    return this
  }

  toOpenApi(): Record<string, unknown> {
    const schema: Record<string, unknown> = { type: 'string' }
    if (this.minLen !== undefined) schema.minLength = this.minLen
    if (this.maxLen !== undefined) schema.maxLength = this.maxLen
    if (this.isEmail) schema.format = 'email'
    return schema
  }

  toMongoField(): Record<string, unknown> {
    const field: Record<string, unknown> = { type: String }
    if (!this.isOptional) field.required = true
    if (this._hasDefault) field.default = this.defaultValue
    if (this._isUnique) field.unique = true
    if (this._index) field.index = true
    if (this.minLen !== undefined) field.minlength = this.minLen
    if (this.maxLen !== undefined) field.maxlength = this.maxLen
    if (this.regexPattern) field.match = this.regexPattern
    return field
  }

  _validate(
    value: unknown,
    path: string
  ):
    | { success: true; data: string }
    | { success: false; errors: ValidationError[] } {
    if (value === undefined || value === null) {
      if (this.isOptional) return { success: true, data: undefined as never }
      return { success: false, errors: [{ path, message: 'Required' }] }
    }
    if (typeof value !== 'string')
      return { success: false, errors: [{ path, message: 'Expected string' }] }
    let typedVal = value
    for (const s of this._sanitizers) typedVal = s(typedVal)
    if (this.minLen !== undefined && typedVal.length < this.minLen)
      return {
        success: false,
        errors: [
          {
            path,
            message:
              this.minMsg ??
              `String must be at least ${this.minLen} characters`,
          },
        ],
      }
    if (this.maxLen !== undefined && typedVal.length > this.maxLen)
      return {
        success: false,
        errors: [
          {
            path,
            message:
              this.maxMsg ?? `String must be at most ${this.maxLen} characters`,
          },
        ],
      }
    if (this.isEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(typedVal))
      return {
        success: false,
        errors: [{ path, message: this.emailMsg ?? 'Invalid email' }],
      }
    if (this.regexPattern !== undefined && !this.regexPattern.test(typedVal))
      return {
        success: false,
        errors: [{ path, message: this.regexMsg ?? 'Invalid format' }],
      }

    return { success: true, data: typedVal }
  }
}

export class NumberValidator extends ValidatorType<number> {
  private minVal?: number
  private minMsg?: string
  private maxVal?: number
  private maxMsg?: string

  min(val: number, message?: string) {
    this.minVal = val
    this.minMsg = message
    return this
  }
  max(val: number, message?: string) {
    this.maxVal = val
    this.maxMsg = message
    return this
  }

  toOpenApi(): Record<string, unknown> {
    const schema: Record<string, unknown> = { type: 'number' }
    if (this.minVal !== undefined) schema.minimum = this.minVal
    if (this.maxVal !== undefined) schema.maximum = this.maxVal
    return schema
  }

  toMongoField(): Record<string, unknown> {
    const field: Record<string, unknown> = { type: Number }
    if (!this.isOptional) field.required = true
    if (this._hasDefault) field.default = this.defaultValue
    if (this._isUnique) field.unique = true
    if (this._index) field.index = true
    if (this.minVal !== undefined) field.min = this.minVal
    if (this.maxVal !== undefined) field.max = this.maxVal
    return field
  }

  _validate(
    value: unknown,
    path: string
  ):
    | { success: true; data: number }
    | { success: false; errors: ValidationError[] } {
    if (value === undefined || value === null) {
      if (this.isOptional) return { success: true, data: undefined as never }
      return { success: false, errors: [{ path, message: 'Required' }] }
    }
    if (
      typeof value === 'boolean' ||
      (typeof value === 'string' && value.trim() === '')
    ) {
      return { success: false, errors: [{ path, message: 'Expected number' }] }
    }
    const num = Number(value)
    if (isNaN(num))
      return {
        success: false,
        errors: [{ path, message: 'Expected valid number' }],
      }
    if (this.minVal !== undefined && num < this.minVal)
      return {
        success: false,
        errors: [
          {
            path,
            message: this.minMsg ?? `Number must be at least ${this.minVal}`,
          },
        ],
      }
    if (this.maxVal !== undefined && num > this.maxVal)
      return {
        success: false,
        errors: [
          {
            path,
            message: this.maxMsg ?? `Number must be at most ${this.maxVal}`,
          },
        ],
      }
    return { success: true, data: num }
  }
}

export class CoerceNumberValidator extends NumberValidator {
  _validate(
    value: unknown,
    path: string
  ):
    | { success: true; data: number }
    | { success: false; errors: ValidationError[] } {
    if (value === undefined || value === null) {
      if (this.isOptional) return { success: true, data: undefined as never }
      return { success: false, errors: [{ path, message: 'Required' }] }
    }
    if (
      typeof value === 'boolean' ||
      (typeof value === 'string' && value.trim() === '')
    ) {
      return { success: false, errors: [{ path, message: 'Expected number' }] }
    }
    const num = Number(value)
    return super._validate(num, path)
  }
}

export class BooleanValidator extends ValidatorType<boolean> {
  toOpenApi(): Record<string, unknown> {
    return { type: 'boolean' }
  }

  toMongoField(): Record<string, unknown> {
    const field: Record<string, unknown> = { type: Boolean }
    if (!this.isOptional) field.required = true
    if (this._hasDefault) field.default = this.defaultValue
    return field
  }
  _validate(
    value: unknown,
    path: string
  ):
    | { success: true; data: boolean }
    | { success: false; errors: ValidationError[] } {
    if (value === undefined || value === null) {
      if (this.isOptional) return { success: true, data: undefined as never }
      return { success: false, errors: [{ path, message: 'Required' }] }
    }
    if (typeof value === 'boolean') {
      let typedVal = value
      for (const s of this._sanitizers) typedVal = s(typedVal)
      return { success: true, data: typedVal }
    }
    if (value === 'true' || value === '1') {
      let typedVal = true
      for (const s of this._sanitizers) typedVal = s(typedVal)
      return { success: true, data: typedVal }
    }
    if (value === 'false' || value === '0')
      return { success: true, data: false }
    return { success: false, errors: [{ path, message: 'Expected boolean' }] }
  }
}

export class CoerceBooleanValidator extends BooleanValidator {
  _validate(
    value: unknown,
    path: string
  ):
    | { success: true; data: boolean }
    | { success: false; errors: ValidationError[] } {
    if (value === undefined || value === null) {
      if (this.isOptional) return { success: true, data: undefined as never }
      return { success: false, errors: [{ path, message: 'Required' }] }
    }
    if (typeof value === 'boolean') {
      let typedVal = value
      for (const s of this._sanitizers) typedVal = s(typedVal)
      return { success: true, data: typedVal }
    }
    if (value === 'true' || value === '1') {
      let typedVal = true
      for (const s of this._sanitizers) typedVal = s(typedVal)
      return { success: true, data: typedVal }
    }
    if (value === 'false' || value === '0')
      return { success: true, data: false }
    return { success: false, errors: [{ path, message: 'Expected boolean' }] }
  }
}

export class ObjectValidator<
  T extends Record<string, ValidatorType<unknown>>,
> extends ValidatorType<{
  [K in keyof T]: T[K] extends ValidatorType<infer U> ? U : never
}> {
  private _keys: string[]

  constructor(private shape: T) {
    super()
    this._keys = Object.keys(shape)
  }

  partial(): ObjectValidator<{ [K in keyof T]: ValidatorType<any> }> {
    const newShape: any = {}
    for (const key of this._keys) {
      newShape[key] = (this.shape[key] as any).optional()
    }
    return new ObjectValidator(newShape) as never
  }

  pick<K extends keyof T>(keys: K[]): ObjectValidator<{ [P in K]: T[P] }> {
    const newShape: any = {}
    for (const key of keys) {
      if (key in this.shape) {
        newShape[key] = this.shape[key]
      }
    }
    return new ObjectValidator(newShape) as never
  }

  omit<K extends keyof T>(keys: K[]): ObjectValidator<Omit<T, K>> {
    const newShape: any = {}
    for (const key of this._keys) {
      if (!keys.includes(key as never)) {
        newShape[key] = this.shape[key]
      }
    }
    return new ObjectValidator(newShape) as never
  }

  toOpenApi(): Record<string, unknown> {
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const key of this._keys) {
      const validator = this.shape[key]
      properties[key] = validator.toOpenApi()
      if (!(validator as unknown as { isOptional?: boolean }).isOptional) {
        required.push(key)
      }
    }

    const schema: Record<string, unknown> = {
      type: 'object',
      properties,
    }
    if (required.length > 0) schema.required = required
    return schema
  }

  /**
   * Converts this tex.object() schema into a Mongoose-compatible schema definition.
   * Pass the result directly to `new mongoose.Schema()`.
   *
   * @example
   * const UserSchema = tex.object({ name: tex.string(), email: tex.email() })
   * const User = mongoose.model('User', new mongoose.Schema(UserSchema.toMongoSchema()))
   */
  toMongoSchema(): {
    [K in keyof T]: {
      __typehint: T[K] extends ValidatorType<infer U> ? U : never
      __rawDocTypeHint: T[K] extends ValidatorType<infer U> ? U : never
      __hydratedDocTypeHint: T[K] extends ValidatorType<infer U> ? U : never
    }
  } {
    const schemaDef: Record<string, unknown> = {}
    for (const key of this._keys) {
      const validator = this.shape[key]
      schemaDef[key] = validator.toMongoField()
    }
    return schemaDef as {
      [K in keyof T]: {
        __typehint: T[K] extends ValidatorType<infer U> ? U : never
        __rawDocTypeHint: T[K] extends ValidatorType<infer U> ? U : never
        __hydratedDocTypeHint: T[K] extends ValidatorType<infer U> ? U : never
      }
    }
  }

  toMongoField(): Record<string, unknown> {
    // Nested object — return the shape as a sub-document definition
    const nested: Record<string, unknown> = {}
    for (const key of this._keys) {
      nested[key] = this.shape[key].toMongoField()
    }
    return nested
  }

  _validate(
    value: unknown,
    path: string
  ):
    | {
        success: true
        data: {
          [K in keyof T]: T[K] extends ValidatorType<infer U> ? U : never
        }
      }
    | { success: false; errors: ValidationError[] } {
    if (value === undefined || value === null) {
      if (this.isOptional) return { success: true, data: undefined as never }
      return { success: false, errors: [{ path, message: 'Required' }] }
    }
    if (typeof value !== 'object' || Array.isArray(value))
      return { success: false, errors: [{ path, message: 'Expected object' }] }

    const errors: ValidationError[] = []
    const data: Record<string, unknown> = {}

    for (const key of this._keys) {
      const validator = this.shape[key]
      const fieldPath = path ? `${path}.${key}` : key
      const result = validator.validate((value as never)[key], fieldPath)
      if (result.success) {
        if (result.data !== undefined) data[key] = result.data
      } else {
        for (const error of result.errors) {
          errors.push(error)
        }
      }
    }

    if (errors.length > 0) return { success: false, errors }
    let typedVal = data
    for (const s of this._sanitizers) typedVal = s(typedVal)
    return { success: true, data: typedVal as never }
  }

  async _validateAsync(
    value: unknown,
    path: string
  ): Promise<
    | {
        success: true
        data: {
          [K in keyof T]: T[K] extends ValidatorType<infer U> ? U : never
        }
      }
    | { success: false; errors: ValidationError[] }
  > {
    if (value === undefined || value === null) {
      if (this.isOptional) return { success: true, data: undefined as never }
      return { success: false, errors: [{ path, message: 'Required' }] }
    }
    if (typeof value !== 'object' || Array.isArray(value))
      return { success: false, errors: [{ path, message: 'Expected object' }] }

    const errors: ValidationError[] = []
    const data: Record<string, unknown> = {}

    await Promise.all(
      this._keys.map(async (key) => {
        const validator = this.shape[key]
        const fieldPath = path ? `${path}.${key}` : key
        const result = await validator.validateAsync(
          (value as never)[key],
          fieldPath
        )
        if (result.success) {
          if (result.data !== undefined) data[key] = result.data
        } else {
          for (const error of result.errors) {
            errors.push(error)
          }
        }
      })
    )

    if (errors.length > 0) return { success: false, errors }
    let typedVal = data
    for (const s of this._sanitizers) typedVal = s(typedVal)
    return { success: true, data: typedVal as never }
  }
}

export class ArrayValidator<
  T extends ValidatorType<unknown>,
> extends ValidatorType<ReturnType<T['parse']>[]> {
  private minLen?: number
  private minMsg?: string
  private maxLen?: number
  private maxMsg?: string

  constructor(private schema: T) {
    super()
  }

  min(len: number, message?: string) {
    this.minLen = len
    this.minMsg = message
    return this
  }
  max(len: number, message?: string) {
    this.maxLen = len
    this.maxMsg = message
    return this
  }

  toOpenApi(): Record<string, unknown> {
    const schema: Record<string, unknown> = {
      type: 'array',
      items: this.schema.toOpenApi(),
    }
    if (this.minLen !== undefined) schema.minItems = this.minLen
    if (this.maxLen !== undefined) schema.maxItems = this.maxLen
    return schema
  }

  toMongoField(): Record<string, unknown> {
    // Return as Mongoose array syntax: [{ type: String }]
    const innerField = this.schema.toMongoField()
    return [innerField] as any
  }

  _validate(
    value: unknown,
    path: string
  ):
    | { success: true; data: ReturnType<T['parse']>[] }
    | { success: false; errors: ValidationError[] } {
    if (value === undefined || value === null) {
      if (this.isOptional) return { success: true, data: undefined as never }
      return { success: false, errors: [{ path, message: 'Required' }] }
    }
    if (!Array.isArray(value))
      return { success: false, errors: [{ path, message: 'Expected array' }] }

    if (this.minLen !== undefined && value.length < this.minLen)
      return {
        success: false,
        errors: [
          {
            path,
            message:
              this.minMsg ?? `Array must have at least ${this.minLen} items`,
          },
        ],
      }
    if (this.maxLen !== undefined && value.length > this.maxLen)
      return {
        success: false,
        errors: [
          {
            path,
            message:
              this.maxMsg ?? `Array must have at most ${this.maxLen} items`,
          },
        ],
      }

    const errors: ValidationError[] = []
    const data: unknown[] = []

    for (let i = 0; i < value.length; i++) {
      const res = this.schema.validate(
        value[i],
        path ? `${path}[${i}]` : `[${i}]`
      )
      if (res.success) {
        data.push(res.data)
      } else {
        for (const error of res.errors) {
          errors.push(error)
        }
      }
    }

    if (errors.length > 0) return { success: false, errors }
    return { success: true, data: data as never }
  }
}

export class EnumValidator<
  U extends string,
  T extends [U, ...U[]],
> extends ValidatorType<T[number]> {
  constructor(private values: T) {
    super()
  }
  toOpenApi(): Record<string, unknown> {
    return { type: 'string', enum: this.values }
  }

  toMongoField(): Record<string, unknown> {
    const field: Record<string, unknown> = {
      type: String,
      enum: [...this.values],
    }
    if (!this.isOptional) field.required = true
    if (this._hasDefault) field.default = this.defaultValue
    if (this._isUnique) field.unique = true
    if (this._index) field.index = true
    return field
  }
  _validate(
    value: unknown,
    path: string
  ):
    | { success: true; data: T[number] }
    | { success: false; errors: ValidationError[] } {
    if (value === undefined || value === null) {
      if (this.isOptional) return { success: true, data: undefined as never }
      return { success: false, errors: [{ path, message: 'Required' }] }
    }
    if (typeof value !== 'string')
      return { success: false, errors: [{ path, message: 'Expected string' }] }
    let typedVal = value
    for (const s of this._sanitizers) typedVal = s(typedVal)
    if (!this.values.includes(typedVal as T[number]))
      return {
        success: false,
        errors: [
          { path, message: `Expected one of: ${this.values.join(', ')}` },
        ],
      }
    return { success: true, data: typedVal as T[number] }
  }
}

export class LiteralValidator<
  T extends string | number | boolean,
> extends ValidatorType<T> {
  constructor(private exact: T) {
    super()
  }
  toOpenApi(): Record<string, unknown> {
    return { type: typeof this.exact, enum: [this.exact] }
  }
  _validate(
    value: unknown,
    path: string
  ):
    { success: true; data: T } | { success: false; errors: ValidationError[] } {
    if (value === undefined || value === null) {
      if (this.isOptional) return { success: true, data: undefined as never }
      return { success: false, errors: [{ path, message: 'Required' }] }
    }
    if (value !== this.exact)
      return {
        success: false,
        errors: [{ path, message: `Expected literal ${this.exact}` }],
      }
    return { success: true, data: value as T }
  }
}

export class UnionValidator<
  T extends ValidatorType<unknown>[],
> extends ValidatorType<ReturnType<T[number]['parse']>> {
  constructor(private schemas: T) {
    super()
  }
  toOpenApi(): Record<string, unknown> {
    return { anyOf: this.schemas.map((s) => s.toOpenApi()) }
  }
  _validate(
    value: unknown,
    path: string
  ):
    | { success: true; data: ReturnType<T[number]['parse']> }
    | { success: false; errors: ValidationError[] } {
    if (value === undefined || value === null) {
      if (this.isOptional) return { success: true, data: undefined as never }
      return { success: false, errors: [{ path, message: 'Required' }] }
    }
    const errors: ValidationError[] = []
    for (const schema of this.schemas) {
      const res = schema.validate(value, path)
      if (res.success) return res as never
      errors.push(...res.errors)
    }
    return {
      success: false,
      errors: [{ path, message: 'Invalid union value' }],
    }
  }
}

export class DateValidator extends ValidatorType<Date> {
  toOpenApi(): Record<string, unknown> {
    return { type: 'string', format: 'date-time' }
  }

  toMongoField(): Record<string, unknown> {
    const field: Record<string, unknown> = { type: Date }
    if (!this.isOptional) field.required = true
    if (this._hasDefault) field.default = this.defaultValue
    if (this._index) field.index = true
    return field
  }
  _validate(
    value: unknown,
    path: string
  ):
    | { success: true; data: Date }
    | { success: false; errors: ValidationError[] } {
    if (value === undefined || value === null) {
      if (this.isOptional) return { success: true, data: undefined as never }
      return { success: false, errors: [{ path, message: 'Required' }] }
    }
    let date: Date
    if (value instanceof Date) {
      date = value
    } else if (typeof value === 'string' || typeof value === 'number') {
      date = new Date(value)
    } else {
      return {
        success: false,
        errors: [{ path, message: 'Expected date string or object' }],
      }
    }

    if (isNaN(date.getTime())) {
      return { success: false, errors: [{ path, message: 'Invalid date' }] }
    }

    return { success: true, data: date }
  }
}

export class RecordValidator<
  T extends ValidatorType<unknown>,
> extends ValidatorType<Record<string, ReturnType<T['parse']>>> {
  constructor(private schema: T) {
    super()
  }
  toOpenApi(): Record<string, unknown> {
    return { type: 'object', additionalProperties: this.schema.toOpenApi() }
  }
  _validate(
    value: unknown,
    path: string
  ):
    | { success: true; data: Record<string, ReturnType<T['parse']>> }
    | { success: false; errors: ValidationError[] } {
    if (value === undefined || value === null) {
      if (this.isOptional) return { success: true, data: undefined as never }
      return { success: false, errors: [{ path, message: 'Required' }] }
    }
    if (typeof value !== 'object' || Array.isArray(value))
      return { success: false, errors: [{ path, message: 'Expected object' }] }

    const errors: ValidationError[] = []
    const data: Record<string, unknown> = {}

    for (const key in value) {
      const fieldPath = path ? `${path}.${key}` : key
      const res = this.schema.validate((value as never)[key], fieldPath)
      if (res.success) {
        data[key] = res.data
      } else {
        for (const error of res.errors) {
          errors.push(error)
        }
      }
    }

    if (errors.length > 0) return { success: false, errors }
    return { success: true, data: data as never }
  }
}
// ─── Any Validator ─────────────────────────────────────────────────────────────

export class AnyValidator extends ValidatorType<unknown> {
  toOpenApi(): Record<string, unknown> {
    return {}
  }

  _validate(value: unknown): { success: true; data: unknown } {
    return { success: true, data: value }
  }
}

export class FileValidator extends ValidatorType<{
  filename: string
  mimeType: string
  buffer: Buffer
}> {
  private _maxSize?: number
  private _mimeTypes?: string[]

  maxSize(bytes: number) {
    this._maxSize = bytes
    return this
  }

  mimeTypes(types: string[]) {
    this._mimeTypes = types
    return this
  }

  toOpenApi(): Record<string, unknown> {
    return { type: 'string', format: 'binary' }
  }

  _validate(
    value: unknown,
    path: string
  ):
    | {
        success: true
        data: { filename: string; mimeType: string; buffer: Buffer }
      }
    | { success: false; errors: ValidationError[] } {
    if (value === undefined || value === null) {
      if (this.isOptional) return { success: true, data: undefined as never }
      return { success: false, errors: [{ path, message: 'Required' }] }
    }

    // We expect the busboy parsed object: { filename, mimeType, buffer }
    if (
      typeof value === 'object' &&
      value !== null &&
      'buffer' in value &&
      Buffer.isBuffer((value as any).buffer)
    ) {
      const file = value as {
        filename: string
        mimeType: string
        buffer: Buffer
      }
      if (this._maxSize && file.buffer.length > this._maxSize) {
        return {
          success: false,
          errors: [
            { path, message: `File size exceeds ${this._maxSize} bytes` },
          ],
        }
      }
      if (this._mimeTypes && !this._mimeTypes.includes(file.mimeType)) {
        return {
          success: false,
          errors: [
            {
              path,
              message: `Invalid mime type. Expected one of: ${this._mimeTypes.join(', ')}`,
            },
          ],
        }
      }
      return { success: true, data: file }
    }

    return { success: false, errors: [{ path, message: 'Expected file' }] }
  }
}

/**
 * @deprecated The `v` validation engine is deprecated in favor of the new string-based `@exisjs/tex` validation engine.
 * Please migrate to `tex.type({ ... })` for native Rust-powered validation.
 */
export const v = {
  string: () => new StringValidator(),
  number: () => new NumberValidator(),
  boolean: () => new BooleanValidator(),
  object: <T extends Record<string, ValidatorType<unknown>>>(shape: T) =>
    new ObjectValidator<T>(shape),
  array: <T extends ValidatorType<unknown>>(schema: T) =>
    new ArrayValidator<T>(schema),
  enum: <U extends string, T extends [U, ...U[]]>(values: T) =>
    new EnumValidator<U, T>(values),
  literal: <T extends string | number | boolean>(exact: T) =>
    new LiteralValidator<T>(exact),
  union: <T extends ValidatorType<unknown>[]>(schemas: T) =>
    new UnionValidator<T>(schemas),
  date: () => new DateValidator(),
  record: <T extends ValidatorType<unknown>>(schema: T) =>
    new RecordValidator<T>(schema),
  any: () => new AnyValidator(),
  file: () => new FileValidator(),
  env: <T extends Record<string, ValidatorType<unknown>>>(
    schema: ObjectValidator<T>
  ): ReturnType<ObjectValidator<T>['parse']> => {
    // Skip validation during build phase — env vars aren't available at build time
    if (process.env.__EXIS_BUILD === 'true') {
      return new Proxy({} as any, {
        get: (_target, prop) => process.env[prop as string],
      })
    }
    const result = schema.validate(process.env, 'process.env')
    if (!result.success) {
      const messages = result.errors
        .map((e) => `  - ${e.path.replace('process.env.', '')}: ${e.message}`)
        .join('\n')
      console.error(
        `\x1b[31m Environment Validation Failed:\x1b[0m\n${messages}`
      )
      process.exit(1)
    }
    return result.data
  },
  coerce: {
    number: () => new CoerceNumberValidator(),
    boolean: () => new CoerceBooleanValidator(),
  },
}

export type Infer<T extends ValidatorType<any>> = ReturnType<T['parse']>
