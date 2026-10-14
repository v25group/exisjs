// Compile-only check (npm run typecheck): augmenting ExisUser through the
// `exisjs` entry types req.user. The field is optional because an
// augmentation applies to every file in the program.
import type { Request } from '../../src/types'

declare module '../../src/index' {
  interface ExisUser {
    __augmentationCheck?: 'typed'
  }
}

type Equal<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
    ? true
    : false

export const augmented: Equal<
  Request['user']['__augmentationCheck'],
  'typed' | undefined
> = true
