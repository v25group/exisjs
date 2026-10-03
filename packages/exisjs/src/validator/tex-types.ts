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

  describe(description: string): this {
    this.description = description
    return this
  }

  example(example: any): this {
    this.exampleValue = example
    return this
  }

  setExample(example: any): this {
    this.exampleValue = example
    return this
  }

  sanitize(...fns: ((val: any) => any)[]): this {
    this.sanitizers.push(...fns)
    return this
  }

  transform<Out>(fn: (val: any) => Out): TexTransformed<Out, IsOpt> {
    const clone = new TexType(this._raw, this.defaultValue) as any
    clone.sanitizers = [...this.sanitizers]
    clone.transformations = [...this.transformations, fn]
    clone.refinements = [...this.refinements]
    clone.description = this.description
    clone.exampleValue = this.exampleValue
    clone.__kind = 'TexTransformed'
    return clone
  }

  refine(
    fn: (val: any) => boolean,
    message?: string | ((val: any) => string)
  ): this {
    this.refinements.push({ async: false, fn, message })
    return this
  }

  refineAsync(
    fn: (val: any) => Promise<boolean>,
    message?: string | ((val: any) => string)
  ): this {
    this.refinements.push({ async: true, fn, message })
    return this
  }

  nullable(): Omit<this, '__isNullable'> & { readonly __isNullable: true } {
    this._raw += ' | nullable'
    return this as any
  }

  optional(): Omit<this, '__isOptional'> & { readonly __isOptional: true } {
    this._raw += ' | optional'
    return this as any
  }

  nullish(): Omit<this, '__isOptional' | '__isNullable'> & {
    readonly __isOptional: true
    readonly __isNullable: true
  } {
    this._raw += ' | nullish'
    return this as any
  }

  toOpenApi(): Record<string, any> {
    const raw: string = this._raw.split('|')[0].trim()
    const isNullable =
      this._raw.includes('nullable') || this._raw.includes('nullish')
    const base = raw.replace('?', '')

    let schema: Record<string, any> = { type: 'string' }

    if (base.startsWith('number')) {
      schema = { type: 'number' }
      const minMatch = this._raw.match(/min:(-?\d+(\.\d+)?)/)
      if (minMatch) schema.minimum = parseFloat(minMatch[1])
      const maxMatch = this._raw.match(/max:(-?\d+(\.\d+)?)/)
      if (maxMatch) schema.maximum = parseFloat(maxMatch[1])
    } else if (base.startsWith('boolean')) {
      schema = { type: 'boolean' }
    } else if (base.startsWith('date')) {
      schema = { type: 'string', format: 'date-time' }
    } else if (base.startsWith('email')) {
      schema = { type: 'string', format: 'email' }
    } else if (base.startsWith('uuid')) {
      schema = { type: 'string', format: 'uuid' }
    } else if (base.startsWith('cuid')) {
      schema = { type: 'string' }
    } else if (base.startsWith('password')) {
      schema = { type: 'string', format: 'password' }
    } else if (base.startsWith('literal:')) {
      const val = base.replace('literal:', '')
      if (val === 'true' || val === 'false') {
        schema = { type: 'boolean', enum: [val === 'true'] }
      } else if (!isNaN(Number(val))) {
        schema = { type: 'number', enum: [Number(val)] }
      } else {
        schema = { type: 'string', enum: [val] }
      }
    } else if (base.startsWith('enum:')) {
      const vals = base.replace('enum:', '').split(',')
      schema = { type: 'string', enum: vals }
    } else if (base.startsWith('array<')) {
      const inner = (this as any)._item
      const itemSchema =
        inner && typeof inner.toOpenApi === 'function'
          ? inner.toOpenApi()
          : { type: 'string' }
      schema = { type: 'array', items: itemSchema }
      const minMatch = this._raw.match(/min:(\d+)/)
      if (minMatch) schema.minItems = parseInt(minMatch[1], 10)
      const maxMatch = this._raw.match(/max:(\d+)/)
      if (maxMatch) schema.maxItems = parseInt(maxMatch[1], 10)
    } else if (base.startsWith('record<')) {
      schema = { type: 'object', additionalProperties: true }
    } else if (base.startsWith('file')) {
      schema = { type: 'string', format: 'binary' }
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

export type IsOptional<T> = T extends { __isOptional: infer IsOpt }
  ? IsOpt extends true
    ? true
    : false
  : T extends { _isOptional: true }
    ? true
    : false // Handle TexEngine

export type IsNullable<T> = T extends { __isNullable: infer IsNull }
  ? IsNull extends true
    ? true
    : false
  : false

export type ApplyNullable<T, Type> =
  IsNullable<T> extends true ? Type | null : Type

export type ResolveSchema<T extends Record<string, any>> = {
  // Required fields
  [K in keyof T as IsOptional<T[K]> extends false ? K : never]: ApplyNullable<
    T[K],
    ResolveTexType<T[K]>
  >
} & {
  // Optional fields
  [K in keyof T as IsOptional<T[K]> extends true ? K : never]?: ApplyNullable<
    T[K],
    ResolveTexType<T[K]>
  >
}

export type Infer<T extends { _type: any }> = T['_type']
