import type { App } from '../server/app'
import type { Logger } from '../types'

export type CronSchedule = string | Date | number

export type OverlapPolicy = 'skip' | 'queue'

export type CronJobStatus = 'idle' | 'running' | 'paused' | 'stopped'

export interface CronJobOptions {
  /** Unique name for the cron job */
  name?: string
  /** Cron pattern (e.g. '0 0 * * *' or '0 *\/5 * * * *') */
  schedule?: string
  /** Interval in milliseconds */
  interval?: number
  /** Timeout delay in milliseconds (runs once) */
  timeout?: number
  /** IANA Timezone string (e.g. 'UTC', 'America/New_York', 'Asia/Kolkata') */
  timezone?: string
  /**
   * If true, prevents concurrent executions if the job takes longer than its interval.
   * Default: true
   */
  preventOverlap?: boolean
  /** Action to take when an execution overlaps ('skip' to drop, 'queue' to run immediately after) */
  onOverlap?: OverlapPolicy
  /** Whether the job starts running automatically upon registration. Default: true */
  autoStart?: boolean
  /** Number of retry attempts if the handler throws an error */
  retries?: number
  /** Backoff strategy between retries in milliseconds */
  retryDelayMs?: number
  /** Optional error hook specific to this job */
  onError?: (err: Error, context: CronContext) => void | Promise<void>
  /** Handler function for the cron job */
  run?: (context: CronContext) => any | Promise<any>
  /** Alternative handler key name */
  handle?: (context: CronContext) => any | Promise<any>
}

export interface CronContext {
  /** The Exis application instance */
  app: App<any>
  /** Structured logger */
  log: Logger
  /** Name of the running job */
  jobName: string
  /** Timestamp when this execution started */
  startedAt: Date
  /** Current execution iteration count */
  iteration: number
  /** Signal that aborts when the server initiates graceful shutdown */
  signal?: AbortSignal
}

export interface CronJobStats {
  name: string
  status: CronJobStatus
  schedule?: string
  intervalMs?: number
  timezone?: string
  preventOverlap: boolean
  lastRun?: Date
  nextRun?: Date
  executionCount: number
  failureCount: number
  lastDurationMs?: number
  lastError?: string
}

export interface IntervalOptions {
  name?: string
  preventOverlap?: boolean
  autoStart?: boolean
  onError?: (err: Error, context: CronContext) => void | Promise<void>
}

export interface TimeoutOptions {
  name?: string
  autoStart?: boolean
  onError?: (err: Error, context: CronContext) => void | Promise<void>
}
