/**
 * @deprecated The `v` validation engine is deprecated in favor of the new string-based `@exisjs/tex` validation engine.
 * Please migrate to `tex.type({ ... })` for native Rust-powered validation.
 */
import { TexEngine } from './tex'
import type { ValidatorType } from '../utils/validator'

export type Infer<T> =
  T extends TexEngine<infer U>
    ? U
    : T extends ValidatorType<infer V>
      ? V
      : never

export { v, ValidatorError, ValidatorType } from '../utils/validator'

export { tex } from './tex'
