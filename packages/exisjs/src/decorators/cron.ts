import { CRON_REGISTRY, CRON_META } from './constants'
import { MetadataEngine } from './core/metadata'
import type { CronJobOptions } from '../cron/types'

export interface DecoratedCronJobMeta {
  methodName: string
  options: CronJobOptions
}

function applyCronDecorator(
  target: any,
  contextOrPropertyKey: string | symbol | any,
  descriptor: PropertyDescriptor | any,
  cronOptions: CronJobOptions
) {
  const isStandard =
    typeof contextOrPropertyKey === 'object' &&
    contextOrPropertyKey !== null &&
    'name' in contextOrPropertyKey

  if (isStandard) {
    const methodName = String(contextOrPropertyKey.name)
    const options = {
      ...cronOptions,
      name: cronOptions.name || methodName,
    }
    MetadataEngine.set(target, CRON_META, {
      methodName,
      options,
    })
  } else {
    const proto =
      typeof target === 'function' && target.prototype
        ? target.prototype
        : target || {}
    const fn = descriptor ? descriptor.value : proto[contextOrPropertyKey]
    const methodName = String(contextOrPropertyKey || descriptor?.name || '')
    const options = {
      ...cronOptions,
      name: cronOptions.name || methodName,
    }

    MetadataEngine.push(proto, CRON_REGISTRY, {
      methodName,
      options,
    })

    if (fn && typeof fn === 'function') {
      MetadataEngine.set(fn, CRON_META, {
        methodName,
        options,
      })
    }
  }
}

/**
 * Extracts decorated cron jobs from a class constructor or prototype.
 */
export function getCronJobsFromClass(target: any): DecoratedCronJobMeta[] {
  const proto = typeof target === 'function' ? target.prototype : target
  if (!proto) return []

  const registry: DecoratedCronJobMeta[] = [
    ...(MetadataEngine.get(proto, CRON_REGISTRY) || []),
  ]

  for (const key of Object.getOwnPropertyNames(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key)
    if (descriptor && typeof descriptor.value === 'function') {
      const fn = descriptor.value
      const cronMeta = MetadataEngine.get(fn, CRON_META)
      if (cronMeta) {
        const exists = registry.some((c) => c.methodName === key)
        if (!exists) {
          registry.push({ ...cronMeta, methodName: key })
        }
      }
    }
  }

  return registry
}

/**
 * Method decorator to schedule a method on a class as a Cron Job.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class CleanupService {
 *   @Cron('0 0 * * *', { name: 'nightly-purge', timezone: 'UTC', preventOverlap: true })
 *   async purgeOldSessions() {
 *     // Run nightly
 *   }
 * }
 * ```
 */
export function Cron(
  schedule: string,
  options: Omit<CronJobOptions, 'schedule' | 'run' | 'handle'> = {}
): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    applyCronDecorator(target, contextOrPropertyKey, descriptor, {
      ...options,
      schedule,
    })
    return descriptor
  }
}

/**
 * Method decorator to schedule a method on a class to run at recurring millisecond intervals.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class HealthService {
 *   @Interval(60000, { name: 'health-check' })
 *   async pingHealth() {
 *     // Runs every 60s
 *   }
 * }
 * ```
 */
export function Interval(
  ms: number,
  options: Omit<CronJobOptions, 'interval' | 'run' | 'handle'> = {}
): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    applyCronDecorator(target, contextOrPropertyKey, descriptor, {
      ...options,
      interval: ms,
    })
    return descriptor
  }
}

/**
 * Method decorator to schedule a method on a class to run once after a millisecond delay after server start.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class CacheService {
 *   @Timeout(5000, { name: 'warmup-cache' })
 *   async warmupCache() {
 *     // Runs once 5s after startup
 *   }
 * }
 * ```
 */
export function TimeoutTask(
  ms: number,
  options: Omit<CronJobOptions, 'timeout' | 'run' | 'handle'> = {}
): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    applyCronDecorator(target, contextOrPropertyKey, descriptor, {
      ...options,
      timeout: ms,
    })
    return descriptor
  }
}

export const ScheduledTimeout = TimeoutTask
export const Scheduled = Cron
