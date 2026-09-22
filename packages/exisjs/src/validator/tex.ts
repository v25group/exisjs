import { TexBuilder } from './builder'

export { TexBuilder } from './builder'
export const tex = new TexBuilder()
export { TexEngine } from './engine'
export { ValidatorError, getNestedValue, formatReceivedValue } from './error'
export { paginate, getPaginationSkip } from './pagination'
export type {
  TexDefaultValue,
  TexBaseOptions,
  TexStringOptions,
  TexNumberOptions,
  TexBooleanOptions,
  TexArrayOptions,
  TexEnumOptions,
  TexObjectOptions,
  TexFileOptions,
  TexPasswordOptions,
  TexDateOptions,
  ValidationErrorDescriptor,
  PaginationMeta,
  PaginatedResult,
} from './types'
