import {
  TexEngine,
  TexTransformedEngine,
  TexDiscriminatedUnionEngine,
} from './tex'
import type { ResolveSchema as TexResolveSchema } from './tex-types'

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

export {
  tex,
  TexEngine,
  TexTransformedEngine,
  TexDiscriminatedUnionEngine,
  paginate,
  getPaginationSkip,
  type PaginationMeta,
  type PaginatedResult,
} from './tex'
