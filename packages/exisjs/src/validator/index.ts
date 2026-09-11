import { TexEngine } from './tex'
import type { ResolveSchema as TexResolveSchema } from './tex-types'

export type Infer<T> = T extends TexEngine<infer U> ? U : never
export type ResolveSchema<T> =
  T extends TexEngine<infer U>
    ? U
    : T extends Record<string, any>
      ? TexResolveSchema<T>
      : never

export {
  tex,
  paginate,
  getPaginationSkip,
  type PaginationMeta,
  type PaginatedResult,
} from './tex'
