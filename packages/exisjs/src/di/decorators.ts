import {
  INJECT_METADATA,
  PROPERTY_INJECT_METADATA,
  OPTIONAL_METADATA,
  ProviderToken,
} from './container'

/**
 * Parameter or Property decorator that specifies a dependency token to inject.
 * When applied to a property without an explicit token, the dependency type is automatically
 * inferred from TypeScript's emitted metadata (`design:type`).
 *
 * Examples:
 * ```ts
 * // 1. Constructor Parameter Injection
 * class UserService {
 *   constructor(
 *     @Inject('DATABASE_URL') private dbUrl: string,
 *     @Inject(LoggerService) private logger: LoggerService
 *   ) {}
 * }
 *
 * // 2. Property Injection
 * class OrderService {
 *   @Inject()
 *   private logger!: LoggerService
 *
 *   @Inject('CONFIG')
 *   private config!: AppConfig
 * }
 * ```
 */
export function Inject(token?: ProviderToken): any {
  return function (
    target: any,
    propertyKey?: string | symbol,
    parameterIndex?: number
  ) {
    if (typeof parameterIndex === 'number') {
      // 1. Parameter Decorator
      let resolvedToken = token
      if (resolvedToken === undefined) {
        const targetClass =
          typeof target === 'function' ? target : target.constructor
        const paramTypes =
          (typeof (globalThis as any).Reflect?.getMetadata === 'function'
            ? (globalThis as any).Reflect.getMetadata(
                'design:paramtypes',
                targetClass
              )
            : undefined) || []
        if (paramTypes[parameterIndex]) {
          resolvedToken = paramTypes[parameterIndex]
        }
      }

      if (resolvedToken !== undefined) {
        const targetObj = target
        const currentTokens = (targetObj[INJECT_METADATA] =
          targetObj[INJECT_METADATA] || {})
        currentTokens[parameterIndex] = resolvedToken

        if (targetObj.prototype) {
          const protoTokens = (targetObj.prototype[INJECT_METADATA] =
            targetObj.prototype[INJECT_METADATA] || {})
          protoTokens[parameterIndex] = resolvedToken
        }
      }
    } else if (propertyKey !== undefined) {
      // 2. Property Decorator
      let resolvedToken = token
      if (resolvedToken === undefined) {
        const propType =
          typeof (globalThis as any).Reflect?.getMetadata === 'function'
            ? (globalThis as any).Reflect.getMetadata(
                'design:type',
                target,
                propertyKey
              )
            : undefined
        if (
          propType &&
          typeof propType === 'function' &&
          propType !== Object &&
          propType !== String &&
          propType !== Number &&
          propType !== Boolean &&
          propType !== Symbol &&
          propType !== Array &&
          propType !== Function
        ) {
          resolvedToken = propType
        }
      }

      const proto = typeof target === 'function' ? target.prototype : target
      const propInjections: {
        propertyKey: string | symbol
        token?: ProviderToken
      }[] = (proto[PROPERTY_INJECT_METADATA] =
        proto[PROPERTY_INJECT_METADATA] || [])
      propInjections.push({ propertyKey, token: resolvedToken })
    }
  }
}

/**
 * Parameter or Property decorator that marks a dependency as optional.
 * If the dependency cannot be resolved, `undefined` is injected instead of throwing an error.
 *
 * Example:
 * ```ts
 * class NotificationService {
 *   // Constructor
 *   constructor(
 *     @Inject('SLACK_WEBHOOK') @Optional() private webhook?: string
 *   ) {}
 *
 *   // Property
 *   @Inject('METRICS')
 *   @Optional()
 *   private metrics?: MetricsService
 * }
 * ```
 */
export function Optional(): any {
  return function (
    target: any,
    propertyKey?: string | symbol,
    parameterIndex?: number
  ) {
    if (typeof parameterIndex === 'number') {
      const targetObj = target
      const currentOptional: Set<number> = (targetObj[OPTIONAL_METADATA] =
        targetObj[OPTIONAL_METADATA] || new Set<number>())
      currentOptional.add(parameterIndex)

      if (targetObj.prototype) {
        const protoOptional: Set<number> = (targetObj.prototype[
          OPTIONAL_METADATA
        ] = targetObj.prototype[OPTIONAL_METADATA] || new Set<number>())
        protoOptional.add(parameterIndex)
      }
    } else if (propertyKey !== undefined) {
      const proto = typeof target === 'function' ? target.prototype : target
      const optProps: Set<string | symbol> = (proto[OPTIONAL_METADATA] =
        proto[OPTIONAL_METADATA] || new Set<string | symbol>())
      optProps.add(propertyKey)
    }
  }
}
