import { INJECT_METADATA, OPTIONAL_METADATA, ProviderToken } from './container'

/**
 * Parameter decorator that specifies a dependency token to inject into a class constructor.
 *
 * Example:
 * ```ts
 * class UserService {
 *   constructor(
 *     @Inject('DATABASE_URL') private dbUrl: string,
 *     @Inject(LoggerService) private logger: LoggerService
 *   ) {}
 * }
 * ```
 */
export function Inject(token: ProviderToken): ParameterDecorator {
  return function (
    target: any,
    propertyKey: string | symbol | undefined,
    parameterIndex: number
  ) {
    // For constructor parameters, propertyKey is undefined and target is the constructor function
    const targetObj = propertyKey !== undefined ? target : target
    const currentTokens = (targetObj[INJECT_METADATA] =
      targetObj[INJECT_METADATA] || {})
    currentTokens[parameterIndex] = token

    // Also attach to prototype just in case target varies across transpiler settings
    if (targetObj.prototype) {
      const protoTokens = (targetObj.prototype[INJECT_METADATA] =
        targetObj.prototype[INJECT_METADATA] || {})
      protoTokens[parameterIndex] = token
    }
  }
}

/**
 * Parameter decorator that marks a dependency as optional.
 * If the dependency cannot be resolved, `undefined` is injected instead of throwing an error.
 *
 * Example:
 * ```ts
 * class NotificationService {
 *   constructor(
 *     @Inject('SLACK_WEBHOOK') @Optional() private webhook?: string
 *   ) {}
 * }
 * ```
 */
export function Optional(): ParameterDecorator {
  return function (
    target: any,
    propertyKey: string | symbol | undefined,
    parameterIndex: number
  ) {
    const targetObj = propertyKey !== undefined ? target : target
    const currentOptional: Set<number> = (targetObj[OPTIONAL_METADATA] =
      targetObj[OPTIONAL_METADATA] || new Set<number>())
    currentOptional.add(parameterIndex)

    if (targetObj.prototype) {
      const protoOptional: Set<number> = (targetObj.prototype[
        OPTIONAL_METADATA
      ] = targetObj.prototype[OPTIONAL_METADATA] || new Set<number>())
      protoOptional.add(parameterIndex)
    }
  }
}
