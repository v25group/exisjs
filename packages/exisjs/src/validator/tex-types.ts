import { parseEnumValues, parseLiteral, ruleBase, ruleParts } from './rules'

/**
 * A field schema. Every method returns a new schema, so one schema can be
 * reused in several objects without them affecting each other.
 */
export class TexType<IsOpt extends boolean = false> {
  declare readonly __isOptional: IsOpt
  public sanitizers: ((val: any) => any)[] = []
  public transformations: ((val: any) => any)[] = []
  public refinements: {
    async: boolean
    fn: (val: any) => any
    message?: string | ((val: any) => string)
  }[] = []
  public defaultValue?: any | (() => any)
  public description?: string
  public exampleValue?: any

  constructor(
    public _raw: string,
    defaultValue?: any | (() => any)
  ) {
    this.defaultValue = defaultValue
  }

  /** A copy that shares nothing mutable with this schema */
  private _copy(): this {
    const copy = Object.assign(Object.create(Object.getPrototypeOf(this)), this)
    copy.sanitizers = [...this.sanitizers]
    copy.transformations = [...this.transformations]
    copy.refinements = [...this.refinements]
    return copy
  }

  describe(description: string): this {
    const copy = this._copy()
    copy.description = description
    return copy
  }

  example(example: any): this {
    const copy = this._copy()
    copy.exampleValue = example
    return copy
  }

  setExample(example: any): this {
    return this.example(example)
  }

  /** Functions that clean the value before it is validated. */
  sanitize(...fns: ((val: any) => any)[]): this {
    const copy = this._copy()
    copy.sanitizers.push(...fns)
    return copy
  }

  transform<Out>(fn: (val: any) => Out): TexTransformed<Out, IsOpt> {
    const copy = this._copy() as any
    copy.transformations.push(fn)
    copy.__kind = 'TexTransformed'
    return copy
  }

  /** A custom check; `message` is used when `fn` returns false. */
  refine(
    fn: (val: any) => boolean,
    message?: string | ((val: any) => string)
  ): this {
    const copy = this._copy()
    copy.refinements.push({ async: false, fn, message })
    return copy
  }

  /** An async custom check, run by `parseAsync()` (and route validation). */
  refineAsync(
    fn: (val: any) => Promise<boolean>,
    message?: string | ((val: any) => string)
  ): this {
    const copy = this._copy()
    copy.refinements.push({ async: true, fn, message })
    return copy
  }

  /** Used when the field is missing; a factory runs on every parse. */
  default(value: any): this & { __hasDefault: true } {
    const copy = this._copy()
    copy.defaultValue = value
    const parts = ruleParts(copy._raw)
    if (!parts[0].endsWith('?') && !parts.includes('optional')) {
      copy._raw += ' | optional'
    }
    return copy as any
  }

  /** @internal A copy with one more rule modifier */
  _withModifier(modifier: string): any {
    const copy = this._copy()
    copy._raw += ` | ${modifier}`
    return copy
  }

  nullable(): Omit<this, '__isNullable'> & { readonly __isNullable: true } {
    return this._withModifier('nullable')
  }

  optional(): Omit<this, '__isOptional'> & { readonly __isOptional: true } {
    return this._withModifier('optional')
  }

  nullish(): Omit<this, '__isOptional' | '__isNullable'> & {
    readonly __isOptional: true
    readonly __isNullable: true
  } {
    return this._withModifier('nullish')
  }

  toOpenApi(): Record<string, any> {
    const parts = ruleParts(this._raw)
    const base = ruleBase(this._raw)
    const mods = new Map<string, string>()
    for (const p of parts.slice(1)) {
      const colon = p.indexOf(':')
      if (colon === -1) mods.set(p, '')
      else mods.set(p.slice(0, colon), p.slice(colon + 1))
    }
    const num = (name: string): number | undefined => {
      const v = mods.get(name)
      return v !== undefined && v !== '' && Number.isFinite(Number(v))
        ? Number(v)
        : undefined
    }
    const isNullable = mods.has('nullable') || mods.has('nullish')

    let schema: Record<string, any> = { type: 'string' }

    if (base === 'number') {
      schema = { type: mods.has('int') ? 'integer' : 'number' }
      if (num('min') !== undefined) schema.minimum = num('min')
      if (num('max') !== undefined) schema.maximum = num('max')
    } else if (base === 'boolean') {
      schema = { type: 'boolean' }
    } else if (base === 'date') {
      schema = { type: 'string', format: 'date-time' }
    } else if (base === 'email') {
      schema = { type: 'string', format: 'email' }
    } else if (base === 'url') {
      schema = { type: 'string', format: 'uri' }
    } else if (base === 'uuid') {
      schema = { type: 'string', format: 'uuid' }
    } else if (base === 'cuid') {
      schema = { type: 'string' }
    } else if (base === 'password') {
      schema = { type: 'string', format: 'password' }
    } else if (base.startsWith('literal:')) {
      const val = parseLiteral(base.slice(8))
      schema = { type: typeof val, enum: [val] }
    } else if (base.startsWith('enum:')) {
      schema = { type: 'string', enum: parseEnumValues(base.slice(5)) }
    } else if (base.startsWith('array<')) {
      const inner = (this as any)._item
      const itemSchema =
        inner && typeof inner.toOpenApi === 'function'
          ? inner.toOpenApi()
          : { type: 'string' }
      schema = { type: 'array', items: itemSchema }
      if (num('min') !== undefined) schema.minItems = num('min')
      if (num('max') !== undefined) schema.maxItems = num('max')
    } else if (base.startsWith('record<')) {
      const value = (this as any)._value
      schema = {
        type: 'object',
        additionalProperties:
          value && typeof value.toOpenApi === 'function'
            ? value.toOpenApi()
            : true,
      }
    } else if (base === 'file') {
      schema = { type: 'string', format: 'binary' }
    } else if (base.includes('||')) {
      const options: any[] = (this as any)._options ?? []
      schema = {
        anyOf: options.map((o) =>
          o && typeof o.toOpenApi === 'function' ? o.toOpenApi() : {}
        ),
      }
    }

    if (schema.type === 'string' && base !== 'password') {
      if (num('min') !== undefined) schema.minLength = num('min')
      if (num('max') !== undefined) schema.maxLength = num('max')
      if (num('length') !== undefined) {
        schema.minLength = schema.maxLength = num('length')
      }
      const pattern = mods.get('pattern')
      if (pattern) {
        try {
          schema.pattern = JSON.parse(pattern)[0]
        } catch {
          // not a builder-made pattern
        }
      }
    }

    if (this.description) schema.description = this.description
    if (this.exampleValue !== undefined) schema.example = this.exampleValue
    if (
      this.defaultValue !== undefined &&
      typeof this.defaultValue !== 'function'
    ) {
      schema.default = this.defaultValue
    }
    if (isNullable) schema.nullable = true

    return schema
  }
}

export interface TexString<
  IsOpt extends boolean = false,
> extends TexType<IsOpt> {
  __kind: 'TexString'
}
export interface TexNumber<
  IsOpt extends boolean = false,
> extends TexType<IsOpt> {
  __kind: 'TexNumber'
}
export interface TexBoolean<
  IsOpt extends boolean = false,
> extends TexType<IsOpt> {
  __kind: 'TexBoolean'
}
export interface TexArray<
  T,
  IsOpt extends boolean = false,
> extends TexType<IsOpt> {
  __kind: 'TexArray'
  __item: T
}
export interface TexEnum<
  T,
  IsOpt extends boolean = false,
> extends TexType<IsOpt> {
  __kind: 'TexEnum'
  __values: T
}
export interface TexLiteral<
  T,
  IsOpt extends boolean = false,
> extends TexType<IsOpt> {
  __kind: 'TexLiteral'
  __value: T
}
export interface TexUnion<
  T,
  IsOpt extends boolean = false,
> extends TexType<IsOpt> {
  __kind: 'TexUnion'
  __schemas: T
}
export interface TexDate<IsOpt extends boolean = false> extends TexType<IsOpt> {
  __kind: 'TexDate'
}
export interface TexRecord<
  T,
  IsOpt extends boolean = false,
> extends TexType<IsOpt> {
  __kind: 'TexRecord'
  __value: T
}
export interface TexAny<IsOpt extends boolean = false> extends TexType<IsOpt> {
  __kind: 'TexAny'
}
export interface TexFile<IsOpt extends boolean = false> extends TexType<IsOpt> {
  __kind: 'TexFile'
}
export interface TexTransformed<
  Out,
  IsOpt extends boolean = false,
> extends TexType<IsOpt> {
  __kind: 'TexTransformed'
  __out: Out
}

// Resolves a single field
export type ResolveTexType<T> = T extends {
  __kind: 'TexTransformed'
  __out: infer Out
}
  ? Out
  : T extends { __kind: 'TexString' }
    ? string
    : T extends { __kind: 'TexNumber' }
      ? number
      : T extends { __kind: 'TexBoolean' }
        ? boolean
        : T extends { __kind: 'TexArray'; __item: infer U }
          ? ResolveTexType<U>[]
          : T extends { __kind: 'TexEnum'; __values: infer U }
            ? U
            : T extends { __kind: 'TexLiteral'; __value: infer U }
              ? U
              : T extends { __kind: 'TexUnion'; __schemas: infer U }
                ? U extends (infer Item)[]
                  ? ResolveTexType<Item>
                  : never
                : T extends { __kind: 'TexDate' }
                  ? Date
                  : T extends { __kind: 'TexRecord'; __value: infer U }
                    ? Record<string, ResolveTexType<U>>
                    : T extends { __kind: 'TexAny' }
                      ? any
                      : T extends { __kind: 'TexFile' }
                        ? { filename: string; mimeType: string; buffer: Buffer }
                        : T extends { _type: infer U }
                          ? U // Handles nested TexEngine
                          : T extends Record<string, any>
                            ? ResolveSchema<T>
                            : never

export type IsOptional<T> = T extends { __isOptional: true }
  ? true
  : T extends { _isOptional: true }
    ? true
    : false

export type IsNullable<T> = T extends { __isNullable: true } ? true : false

export type ApplyNullable<T, Type> =
  IsNullable<T> extends true ? Type | null : Type

/**
 * Marks a field built with `default`: a client may omit it, but after
 * parsing it always has a value.
 */
export type WithDefault<T, O> = O extends { default: infer D }
  ? undefined extends D
    ? T
    : T & { __hasDefault: true }
  : T

export type HasDefault<T> = T extends { __hasDefault: true } ? true : false

// Optional after parsing: declared optional and without a default
type IsOutputOptional<T> =
  IsOptional<T> extends true
    ? HasDefault<T> extends true
      ? false
      : true
    : false

// Optional in a request: declared optional, or filled in by a default
type IsInputOptional<T> = IsOptional<T> extends true ? true : HasDefault<T>

/** The parsed value: what a handler receives after validation. */
export type ResolveSchema<T extends Record<string, any>> = {
  [
    K in keyof T as IsOutputOptional<T[K]> extends false ? K : never
  ]: ApplyNullable<T[K], ResolveTexType<T[K]>>
} & {
  [
    K in keyof T as IsOutputOptional<T[K]> extends true ? K : never
  ]?: ApplyNullable<T[K], ResolveTexType<T[K]>>
}

/** Same as `ResolveSchema`: the type after parsing (like `z.output`). */
export type ResolveOutput<T extends Record<string, any>> = ResolveSchema<T>

/**
 * What a client may send (like `z.input`): fields with a `default` may be
 * omitted. Nested objects are described by their parsed type.
 */
export type ResolveInput<T extends Record<string, any>> = {
  [
    K in keyof T as IsInputOptional<T[K]> extends false ? K : never
  ]: ApplyNullable<T[K], ResolveTexType<T[K]>>
} & {
  [
    K in keyof T as IsInputOptional<T[K]> extends true ? K : never
  ]?: ApplyNullable<T[K], ResolveTexType<T[K]>>
}

export type Infer<T extends { _type: any }> = T['_type']
