import {
  TexEngine,
  TexTransformedEngine,
  TexDiscriminatedUnionEngine,
} from './tex'
import type {
  ResolveSchema as TexResolveSchema,
  ResolveInput as TexResolveInput,
} from './tex-types'

export type Infer<T> = T extends { _type: infer U }
  ? U
  : T extends TexEngine<infer U>
    ? U
    : T extends TexTransformedEngine<any, infer Out>
      ? Out
      : T extends TexDiscriminatedUnionEngine<any, infer Variants>
        ? Variants[number]['_type']
        : never

export type ResolveSchema<T> = T extends { _type: infer U }
  ? U
  : T extends TexEngine<infer U>
    ? U
    : T extends Record<string, any>
      ? TexResolveSchema<T>
      : never

/** The type after parsing (like `z.output`). Same as `ResolveSchema`. */
export type ResolveOutput<T> = ResolveSchema<T>

/**
 * What a client may send (like `z.input`): fields with a `default` may be
 * omitted, while `ResolveSchema` / `ResolveOutput` has them as always present.
 */
export type ResolveInput<T> = T extends { _input: infer I }
  ? I
  : T extends { _type: infer U }
    ? U
    : T extends Record<string, any>
      ? TexResolveInput<T>
      : never

export {
  tex,
  TexBuilder,
  TexEngine,
  TexTransformedEngine,
  TexDiscriminatedUnionEngine,
  ValidatorError,
  paginate,
  getPaginationSkip,
  type PaginationMeta,
  type PaginatedResult,
  type ValidationErrorDescriptor,
} from './tex'
export type { SafeParseResult } from './engine'
export { TexType } from './tex-types'
export type {
  TexDefaultValue,
  TexBaseOptions,
  TexStringOptions,
  TexUrlOptions,
  TexNumberOptions,
  TexBooleanOptions,
  TexArrayOptions,
  TexEnumOptions,
  TexObjectOptions,
  TexFileOptions,
  TexPasswordOptions,
  TexDateOptions,
} from './types'
