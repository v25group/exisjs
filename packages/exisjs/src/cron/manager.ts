import type { App } from '../server/app'
import { CronJob } from './job'
import type { CronJobOptions, CronJobStats, CronContext } from './types'
import { every } from './expressions'

export class CronManager {
  private jobs = new Map<string, CronJob>()
  private app: App<any>

  constructor(app: App<any>) {
    this.app = app
  }

  /**
   * Checks whether a cron job with the given name is registered.
   */
  public has(name: string): boolean {
    return this.jobs.has(name)
  }

  /**
   * Registers and optionally starts a scheduled background task or cron job.
   *
   * @param nameOrOptions Job name or configuration options
   * @param schedule Optional cron schedule pattern if name is passed as first argument
   * @param handler Optional execution handler if name is passed as first argument
   * @param options Optional additional configuration options
   * @returns Active `CronJob` instance
   *
   * @example
   * ```ts
   * app.cron.schedule({
   *   name: 'nightly-backup',
   *   schedule: '0 2 * * *',
   *   timezone: 'UTC',
   *   run: async ({ log }) => {
   *     log.info('Running database backup')
   *   }
   * })
   * ```
   */
  public schedule(
    nameOrOptions: string | CronJobOptions,
    schedule?: string,
    handler?: (ctx: CronContext) => any,
    options?: Partial<CronJobOptions>
  ): CronJob {
    let opts: CronJobOptions
    if (typeof nameOrOptions === 'string') {
      opts = {
        name: nameOrOptions,
        schedule: schedule!,
        run: handler!,
        ...options,
      }
    } else {
      opts = nameOrOptions
    }

    const job = new CronJob(opts, this.app)
    if (this.jobs.has(job.name)) {
      this.app.log?.warn(
        { job: job.name },
        `[exis:cron] Overwriting existing cron job "${job.name}"`
      )
      this.jobs.get(job.name)?.stop()
    }
    this.jobs.set(job.name, job)
    return job
  }

  /**
   * Schedules a recurring task using fixed millisecond intervals.
   */
  public interval(
    name: string,
    ms: number,
    handler: (ctx: CronContext) => any,
    options?: Partial<CronJobOptions>
  ): CronJob {
    return this.schedule({
      name,
      interval: ms,
      run: handler,
      ...options,
    })
  }

  /**
   * Schedules a one-time delayed task.
   */
  public timeout(
    name: string,
    ms: number,
    handler: (ctx: CronContext) => any,
    options?: Partial<CronJobOptions>
  ): CronJob {
    return this.schedule({
      name,
      timeout: ms,
      run: handler,
      ...options,
    })
  }

  /**
   * Retrieves a registered cron job by its unique identifier.
   */
  public getJob(name: string): CronJob | undefined {
    return this.jobs.get(name)
  }

  /**
   * Returns a snapshot map of all registered cron jobs and their execution statistics.
   */
  public getJobs(): Map<string, CronJob> {
    return this.jobs
  }

  /**
   * Returns an array of statistics for all registered jobs (last run, failure count, execution duration).
   */
  public getStats(): CronJobStats[] {
    return Array.from(this.jobs.values()).map((job) => job.getStats())
  }

  /**
   * Starts all registered idle, paused, or stopped cron jobs.
   */
  public startAll(): void {
    for (const job of this.jobs.values()) {
      job.start()
    }
  }

  /**
   * Pauses all registered active cron jobs.
   */
  public pauseAll(): void {
    for (const job of this.jobs.values()) {
      job.pause()
    }
  }

  /**
   * Permanently stops all registered cron jobs.
   */
  public stopAll(): void {
    for (const job of this.jobs.values()) {
      job.stop()
    }
  }

  /**
   * Triggers immediate manual execution of a specific cron job by name.
   */
  public async trigger(name: string): Promise<any> {
    const job = this.jobs.get(name)
    if (!job) {
      throw new Error(`[exis:cron] Job "${name}" not found`)
    }
    return job.trigger()
  }

  /**
   * Gracefully waits for all in-flight cron job executions to finish before server shutdown.
   */
  public async drain(timeoutMs = 5000): Promise<void> {
    const drainPromises = Array.from(this.jobs.values()).map((job) =>
      job.drain(timeoutMs)
    )
    await Promise.all(drainPromises)
  }
}

/**
 * Functional definition helper object for ExisJS cron jobs.
 */
export interface FunctionalCronDefinition {
  __isExisCron: true
  options: CronJobOptions
  handler?: (ctx: CronContext) => any
}

/**
 * Declarative helper for creating scheduled background jobs and cron tasks.
 *
 * @param scheduleOrOptions Standard 5/6-field cron pattern (e.g. `'0 * * * *'`) or full `CronJobOptions`
 * @param handler Execution function receiving `CronContext`
 * @returns Functional cron definition ready for export
 *
 * @example
 * ```ts
 * // src/cron/cleanup.ts
 * export default cron('0 0 * * *', async ({ log }) => {
 *   log.info('Running nightly cleanup')
 * })
 * ```
 */
export function cron(
  scheduleOrOptions: string | CronJobOptions,
  handler?: (ctx: CronContext) => any
): FunctionalCronDefinition {
  let options: CronJobOptions

  if (typeof scheduleOrOptions === 'string') {
    options = {
      schedule: scheduleOrOptions,
      run: handler,
    }
  } else {
    options = {
      ...scheduleOrOptions,
      run: handler || scheduleOrOptions.run || scheduleOrOptions.handle,
    }
  }

  return {
    __isExisCron: true,
    options,
    handler: options.run,
  }
}

/**
 * Schedules a cron job with human-readable English duration expressions.
 *
 * @param duration Natural language interval (e.g. `'5 minutes'`, `'1 hour'`, `'30 seconds'`, `'every weekday'`)
 * @param handler Execution function receiving `CronContext`
 * @param options Additional job options (retries, timezone, onError)
 * @returns Functional cron definition
 *
 * @example
 * ```ts
 * export default cron.every('15 minutes', async ({ log }) => {
 *   log.info('Heartbeat check')
 * })
 * ```
 */
cron.every = function (
  duration: string,
  handler: (ctx: CronContext) => any,
  options: Omit<CronJobOptions, 'schedule' | 'run' | 'handle'> = {}
): FunctionalCronDefinition {
  return cron({
    schedule: every(duration),
    run: handler,
    ...options,
  })
}

/**
 * Schedules a background task using millisecond fixed intervals with drift correction.
 *
 * @param ms Millisecond interval between executions
 * @param handler Execution function receiving `CronContext`
 * @param options Additional job options (retries, preventOverlap)
 * @returns Functional cron definition
 *
 * @example
 * ```ts
 * export default cron.interval(60000, async ({ log }) => {
 *   log.info('Running every 60 seconds')
 * })
 * ```
 */
cron.interval = function (
  ms: number,
  handler: (ctx: CronContext) => any,
  options: Omit<CronJobOptions, 'interval' | 'run' | 'handle'> = {}
): FunctionalCronDefinition {
  return cron({
    interval: ms,
    run: handler,
    ...options,
  })
}

/**
 * Schedules a one-time background task to execute after a specified delay.
 *
 * @param ms Delay in milliseconds before execution
 * @param handler Execution function receiving `CronContext`
 * @param options Additional job options
 * @returns Functional cron definition
 *
 * @example
 * ```ts
 * export default cron.timeout(5000, async ({ log }) => {
 *   log.info('Executed once after 5s startup delay')
 * })
 * ```
 */
cron.timeout = function (
  ms: number,
  handler: (ctx: CronContext) => any,
  options: Omit<CronJobOptions, 'timeout' | 'run' | 'handle'> = {}
): FunctionalCronDefinition {
  return cron({
    timeout: ms,
    run: handler,
    ...options,
  })
}

export const defineCron = cron
