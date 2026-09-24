import { logger } from '../logger'

export interface ProfileOptions {
  /** Warning threshold in milliseconds (default: 0 = log all) */
  thresholdMs?: number
  /** Whether to emit a console warning when duration exceeds threshold (default: true) */
  warnSlow?: boolean
  /** Custom label for reporting */
  label?: string
  /** Custom log callback function */
  log?: (info: {
    className: string
    methodName: string
    durationMs: number
    label?: string
  }) => void
}

/**
 * Performance and execution time profiling decorator.
 * Measures execution time with sub-millisecond precision using `performance.now()`.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class ReportService {
 *   @Profile({ thresholdMs: 100, warnSlow: true })
 *   async generateReport() {
 *     return this.heavyComputations()
 *   }
 * }
 * ```
 */
export function Profile(options: ProfileOptions = {}): MethodDecorator {
  return function (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value
    const className = target?.constructor?.name || 'Class'
    const methodName = String(propertyKey)
    const threshold = options.thresholdMs ?? 0
    const warnSlow = options.warnSlow !== false

    descriptor.value = async function (...args: any[]) {
      const start = performance.now()
      try {
        const result = await originalMethod.apply(this, args)
        const duration = performance.now() - start

        if (options.log) {
          options.log({
            className,
            methodName,
            durationMs: Number(duration.toFixed(2)),
            label: options.label,
          })
        } else if (duration >= threshold && warnSlow && threshold > 0) {
          logger.warn(
            `[Profile] ${className}.${methodName} took ${duration.toFixed(
              2
            )}ms (threshold: ${threshold}ms)`
          )
        }

        return result
      } catch (err) {
        const duration = performance.now() - start
        if (options.log) {
          options.log({
            className,
            methodName,
            durationMs: Number(duration.toFixed(2)),
            label: options.label,
          })
        }
        throw err
      }
    }

    return descriptor
  }
}
