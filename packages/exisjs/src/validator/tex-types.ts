export class TexType<IsOpt extends boolean = false> {
  declare readonly __isOptional: IsOpt
  public sanitizers: ((val: any) => any)[] = []
  public refinements: {
    async: boolean
    fn: (val: any) => any
    message?: string | ((val: any) => string)
  }[] = []

  constructor(public _raw: string) {}

  sanitize(...fns: ((val: any) => any)[]): this {
    this.sanitizers.push(...fns)
    return this
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

// Resolves a single field
export type ResolveTexType<T> = T extends { __kind: 'TexString' }
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
                        : never

// Check if a field is optional
export type IsOptional<T> = T extends { __isOptional: infer IsOpt }
  ? IsOpt extends true
    ? true
    : false
  : T extends { _isOptional: true }
    ? true
    : false // Handle TexEngine

export type ResolveSchema<T extends Record<string, any>> = {
  // Required fields
  [K in keyof T as IsOptional<T[K]> extends false ? K : never]: ResolveTexType<
    T[K]
  >
} & {
  // Optional fields
  [K in keyof T as IsOptional<T[K]> extends true ? K : never]?: ResolveTexType<
    T[K]
  >
}
