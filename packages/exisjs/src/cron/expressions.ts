/**
 * Standard, production-tested cron expression constants.
 */
export const CronExpression = {
  EVERY_SECOND: '* * * * * *',
  EVERY_5_SECONDS: '*/5 * * * * *',
  EVERY_10_SECONDS: '*/10 * * * * *',
  EVERY_30_SECONDS: '*/30 * * * * *',
  EVERY_MINUTE: '* * * * *',
  EVERY_2_MINUTES: '*/2 * * * *',
  EVERY_3_MINUTES: '*/3 * * * *',
  EVERY_5_MINUTES: '*/5 * * * *',
  EVERY_10_MINUTES: '*/10 * * * *',
  EVERY_15_MINUTES: '*/15 * * * *',
  EVERY_30_MINUTES: '*/30 * * * *',
  EVERY_HOUR: '0 * * * *',
  EVERY_2_HOURS: '0 */2 * * *',
  EVERY_3_HOURS: '0 */3 * * *',
  EVERY_6_HOURS: '0 */6 * * *',
  EVERY_12_HOURS: '0 */12 * * *',
  EVERY_DAY_AT_MIDNIGHT: '0 0 * * *',
  EVERY_DAY_AT_1AM: '0 1 * * *',
  EVERY_DAY_AT_2AM: '0 2 * * *',
  EVERY_DAY_AT_NOON: '0 12 * * *',
  EVERY_WEEK: '0 0 * * 0',
  EVERY_WEEKDAY: '0 0 * * 1-5',
  EVERY_WEEKEND: '0 0 * * 6,0',
  EVERY_MONTH: '0 0 1 * *',
  EVERY_QUARTER: '0 0 1 1,4,7,10 *',
  EVERY_YEAR: '0 0 1 1 *',
} as const

export type CronExpressionValue =
  (typeof CronExpression)[keyof typeof CronExpression]

/**
 * Human-readable duration converter into standard cron patterns.
 *
 * @example
 * ```typescript
 * every('5 minutes') // Every 5 minutes
 * every('10 seconds') // Every 10 seconds
 * every('2 hours') // Every 2 hours
 * every('1 day') // Daily at midnight
 * ```
 */
export function every(duration: string): string {
  const normalized = duration.trim().toLowerCase()
  const match = normalized.match(
    /^(\d+)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks|mo|month|months)$/
  )

  if (!match) {
    throw new Error(
      `Invalid duration string "${duration}". Expected format like "5 minutes", "30 seconds", "2 hours", "1 day".`
    )
  }

  const count = parseInt(match[1], 10)
  const unit = match[2]

  if (unit.startsWith('s')) {
    if (count === 1) return CronExpression.EVERY_SECOND
    return `*/${count} * * * * *`
  }

  if (unit.startsWith('m') && !unit.startsWith('mo')) {
    if (count === 1) return CronExpression.EVERY_MINUTE
    return `*/${count} * * * *`
  }

  if (unit.startsWith('h')) {
    if (count === 1) return CronExpression.EVERY_HOUR
    return `0 */${count} * * *`
  }

  if (unit.startsWith('d')) {
    if (count === 1) return CronExpression.EVERY_DAY_AT_MIDNIGHT
    return `0 0 */${count} * *`
  }

  if (unit.startsWith('w')) {
    if (count === 1) return CronExpression.EVERY_WEEK
    return `0 0 * * 0`
  }

  if (unit.startsWith('mo')) {
    if (count === 1) return CronExpression.EVERY_MONTH
    return `0 0 1 */${count} *`
  }

  throw new Error(`Unsupported duration unit in "${duration}"`)
}
