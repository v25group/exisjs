import type { App } from '../server/app'
import type {
  CronJobOptions,
  CronJobStatus,
  CronJobStats,
  CronContext,
} from './types'
import {
  parseCronExpression,
  getNextCronDate,
  type ParsedCronPattern,
} from './parser'

export class CronJob {
  public readonly name: string
  public readonly schedule?: string
  public readonly intervalMs?: number
  public readonly timeoutMs?: number
  public readonly timezone?: string
  public readonly preventOverlap: boolean
  public readonly retries: number
  public readonly retryDelayMs: number

  private status: CronJobStatus = 'idle'
  private parsedPattern: ParsedCronPattern | null = null
  private timer: NodeJS.Timeout | null = null
  private runningPromise: Promise<any> | null = null
  private executionCount = 0
  private failureCount = 0
  private lastRun?: Date
  private nextRun?: Date
  private lastDurationMs?: number
  private lastError?: string
  private abortController: AbortController | null = null

  private handler: (ctx: CronContext) => any
  private onErrorHook?: (err: Error, ctx: CronContext) => void | Promise<void>
  private app: App<any>

  constructor(options: CronJobOptions, app: App<any>) {
    this.app = app
    this.name =
      options.name || `job_${Math.random().toString(36).substring(2, 9)}`
    this.schedule = options.schedule
    this.intervalMs = options.interval
    this.timeoutMs = options.timeout
    this.timezone = options.timezone
    this.preventOverlap = options.preventOverlap !== false
    this.retries = options.retries ?? 0
    this.retryDelayMs = options.retryDelayMs ?? 1000
    this.onErrorHook = options.onError

    const fn = options.run || options.handle
    if (typeof fn !== 'function') {
      throw new Error(
        `CronJob "${this.name}" requires a valid handler function ('run' or 'handle')`
      )
    }
    this.handler = fn

    if (this.schedule) {
      this.parsedPattern = parseCronExpression(this.schedule)
    }

    if (options.autoStart !== false) {
      this.start()
    }
  }

  public getStatus(): CronJobStatus {
    return this.status
  }

  public getStats(): CronJobStats {
    return {
      name: this.name,
      status: this.status,
      schedule: this.schedule,
      intervalMs: this.intervalMs,
      timezone: this.timezone,
      preventOverlap: this.preventOverlap,
      lastRun: this.lastRun,
      nextRun: this.nextRun,
      executionCount: this.executionCount,
      failureCount: this.failureCount,
      lastDurationMs: this.lastDurationMs,
      lastError: this.lastError,
    }
  }

  public start(): this {
    if (this.status === 'running' || this.status === 'idle') {
      this.scheduleNextRun()
    } else if (this.status === 'paused' || this.status === 'stopped') {
      this.status = 'idle'
      this.scheduleNextRun()
    }
    return this
  }

  public pause(): this {
    this.status = 'paused'
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.nextRun = undefined
    return this
  }

  public resume(): this {
    if (this.status === 'paused') {
      this.status = 'idle'
      this.scheduleNextRun()
    }
    return this
  }

  public stop(): this {
    this.status = 'stopped'
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    this.nextRun = undefined
    return this
  }

  /**
   * Manually triggers an immediate execution of the job without affecting its recurring schedule.
   */
  public async trigger(): Promise<any> {
    return this.execute('manual')
  }

  /**
   * Schedules the next timer execution.
   */
  private scheduleNextRun(): void {
    if (this.status === 'stopped' || this.status === 'paused') return

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    if (this.timeoutMs !== undefined) {
      this.nextRun = new Date(Date.now() + this.timeoutMs)
      this.timer = setTimeout(async () => {
        await this.execute('timeout')
        this.status = 'stopped'
      }, this.timeoutMs)
      this.timer.unref?.()
      return
    }

    if (this.intervalMs !== undefined) {
      this.nextRun = new Date(Date.now() + this.intervalMs)
      this.timer = setTimeout(async () => {
        await this.execute('interval')
        if (this.status !== 'stopped' && this.status !== 'paused') {
          this.scheduleNextRun()
        }
      }, this.intervalMs)
      this.timer.unref?.()
      return
    }

    if (this.parsedPattern) {
      try {
        const nextDate = getNextCronDate(
          this.parsedPattern,
          new Date(),
          this.timezone
        )
        this.nextRun = nextDate
        const delayMs = Math.max(0, nextDate.getTime() - Date.now())

        this.timer = setTimeout(async () => {
          await this.execute('cron')
          if (this.status !== 'stopped' && this.status !== 'paused') {
            this.scheduleNextRun()
          }
        }, delayMs)
        this.timer.unref?.()
      } catch (err: any) {
        this.app.log?.error(
          { err: err.message, job: this.name },
          `[exis:cron] Failed to compute next execution date for "${this.name}"`
        )
      }
    }
  }

  /**
   * Executes the handler inside an isolated error sandbox with overlap prevention.
   */
  private async execute(_triggerSource: string): Promise<any> {
    if (this.status === 'running' && this.preventOverlap) {
      this.app.log?.warn(
        { job: this.name },
        `[exis:cron] Skipped execution of "${this.name}" because previous instance is still running (preventOverlap: true)`
      )
      return
    }

    const previousStatus = this.status
    this.status = 'running'
    this.abortController = new AbortController()

    const startedAt = new Date()
    this.lastRun = startedAt
    this.executionCount++

    const context: CronContext = {
      app: this.app,
      log: this.app.log,
      jobName: this.name,
      startedAt,
      iteration: this.executionCount,
      signal: this.abortController.signal,
    }

    const startTimer = process.hrtime()

    const runWithRetry = async (attempt = 0): Promise<any> => {
      try {
        return await this.handler(context)
      } catch (err: any) {
        if (attempt < this.retries) {
          this.app.log?.warn(
            { job: this.name, attempt: attempt + 1, retries: this.retries },
            `[exis:cron] Retrying job "${this.name}" in ${this.retryDelayMs}ms`
          )
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs))
          return runWithRetry(attempt + 1)
        }
        throw err
      }
    }

    this.runningPromise = runWithRetry()

    try {
      const result = await this.runningPromise
      const [sec, nano] = process.hrtime(startTimer)
      this.lastDurationMs = Math.round(sec * 1000 + nano / 1e6)
      this.lastError = undefined
      return result
    } catch (err: any) {
      const [sec, nano] = process.hrtime(startTimer)
      this.lastDurationMs = Math.round(sec * 1000 + nano / 1e6)
      this.failureCount++
      this.lastError = err?.message || String(err)

      this.app.log?.error(
        {
          err: this.lastError,
          job: this.name,
          durationMs: this.lastDurationMs,
        },
        `[exis:cron] Unhandled error in cron job "${this.name}"`
      )

      if (this.onErrorHook) {
        try {
          await this.onErrorHook(err as Error, context)
        } catch (hookErr: any) {
          this.app.log?.error(
            { err: hookErr.message, job: this.name },
            `[exis:cron] Error in onError hook for "${this.name}"`
          )
        }
      }
    } finally {
      this.runningPromise = null
      this.abortController = null
      if (this.status === 'running') {
        this.status = previousStatus === 'running' ? 'idle' : previousStatus
      }
    }
  }

  /**
   * Awaits completion of in-flight execution during graceful shutdown.
   */
  public async drain(timeoutMs = 5000): Promise<void> {
    this.stop()
    if (this.runningPromise) {
      let timeoutHandle: NodeJS.Timeout | undefined
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(
              `[exis:cron] Job "${this.name}" drain timed out after ${timeoutMs}ms`
            )
          )
        }, timeoutMs)
        timeoutHandle.unref?.()
      })

      try {
        await Promise.race([this.runningPromise, timeoutPromise])
      } catch (err) {
        this.app.log?.warn(
          { err },
          `[exis:cron] Drain timeout on job "${this.name}"`
        )
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle)
      }
    }
  }
}
