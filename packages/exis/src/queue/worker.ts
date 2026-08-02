import type {
  QueueConfig,
  JobDefinition,
  JobPayload,
  QueueDriver,
} from './types'
import { createSilentLogger } from '../utils/logger'
import type { LogFn } from '../types'
import { ThreadPool } from '../threads/pool'
import { MemoryQueueDriver } from './drivers/MemoryDriver'
import { RedisQueueDriver } from './drivers/RedisDriver'

export class ExisWorker {
  private driver: QueueDriver | null = null
  private jobs = new Map<string, JobDefinition>()
  private isRunning = false
  private logger: { error: LogFn; info: LogFn; debug: LogFn }
  private concurrency: number
  private activeWorkers = 0
  private threadPool: ThreadPool | null = null

  constructor(
    config: QueueConfig,
    logger?: any,
    driverOverride?: QueueDriver | null
  ) {
    this.concurrency = config.maxConcurrent || config.concurrency || 1
    this.logger = logger || createSilentLogger()

    const prefix = config.prefix || 'exis:queue'
    const driverType =
      config.driver || (config.redis || config.redisUrl ? 'redis' : null)

    if (driverOverride) {
      this.driver = driverOverride
    } else if (driverType === 'redis') {
      if (config.redis) {
        this.driver = new RedisQueueDriver(config.redis.duplicate(), prefix)
      } else if (config.redisUrl) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const IORedis = require('ioredis')
        this.driver = new RedisQueueDriver(
          new IORedis(config.redisUrl, { maxRetriesPerRequest: null }),
          prefix
        )
      } else {
        throw new Error(
          'Redis driver requires redisUrl or redis client instance'
        )
      }
    } else if (driverType === 'memory') {
      this.driver = new MemoryQueueDriver()
    } else if (driverType === 'database') {
      throw new Error('Database driver is not yet implemented')
    }
  }

  registerJob(jobDef: JobDefinition) {
    this.jobs.set(jobDef.name, jobDef)
  }

  async start() {
    if (!this.driver) return
    if (this.jobs.size === 0) return
    this.isRunning = true
    this.logger.info(
      `Queue worker started with concurrency ${this.concurrency} (Thread Pool enabled)`
    )

    this.threadPool = new ThreadPool(this.concurrency)

    this.startSweeper()

    for (let i = 0; i < this.concurrency; i++) {
      this.poll()
    }
  }

  private startSweeper() {
    if (!this.isRunning || !this.driver) return
    setTimeout(async () => {
      try {
        await this.driver!.sweep(this.jobs)
      } catch (err: any) {
        this.logger.error({ err }, 'Sweeper error')
      } finally {
        this.startSweeper()
      }
    }, 10000).unref()
  }

  private async poll() {
    if (!this.isRunning || !this.driver) return

    this.activeWorkers++
    try {
      const res = await this.driver.poll(this.jobs)

      if (res) {
        const { jobId, payloadStr } = res
        // The queueKey contains the job name somewhere, but actually we can just look it up
        // wait, we can just parse the payload!
        let payload: JobPayload | null = null
        try {
          payload = JSON.parse(payloadStr) as JobPayload
        } catch {
          // ignore parse error
        }

        if (payload && payload.name) {
          const jobDef = this.jobs.get(payload.name)
          if (jobDef) {
            await this.processJob(jobDef, jobId, payloadStr)
          } else {
            this.logger.error(
              `Job popped but no definition found for '${payload.name}'. The job has been discarded.`
            )
          }
        }
      } else {
        await new Promise((r) => setTimeout(r, 1000))
      }
    } catch (err: any) {
      if (err.name !== 'MaxRetriesPerRequestError') {
        this.logger.debug({ err: err.message }, 'Worker poll error')
      }
      await new Promise((r) => setTimeout(r, 3000)) // backoff on connection error
    } finally {
      this.activeWorkers--
      if (this.isRunning) {
        setImmediate(() => this.poll())
      }
    }
  }

  private async processJob(
    jobDef: JobDefinition,
    jobId: string,
    payloadStr: string
  ) {
    let payload: JobPayload | null = null
    try {
      payload = JSON.parse(payloadStr) as JobPayload
      payload.attemptsMade = (payload.attemptsMade || 0) + 1

      if (jobDef.schema) {
        payload.data = jobDef.schema.parse(payload.data)
      }

      this.logger.debug(
        `Processing job ${payload.name}:${payload.id} in Thread Pool`
      )

      if (jobDef.onJobStart) {
        Promise.resolve(jobDef.onJobStart(payload)).catch(() => {
          /* ignore */
        })
      }

      if (jobDef.handler) {
        await jobDef.handler(payload)
      } else if (jobDef.filePath && this.threadPool) {
        await this.threadPool.runJob(jobDef.filePath, payload)
      } else {
        throw new Error(`Job ${jobDef.name} has no handler or filePath!`)
      }

      this.logger.info(`Completed job ${payload.name}:${payload.id}`)
      if (jobDef.onJobSuccess) {
        Promise.resolve(jobDef.onJobSuccess(payload)).catch(() => {
          /* ignore */
        })
      }

      if (this.driver) {
        await this.driver.acknowledge(jobDef.name, jobId)
      }
    } catch (err: any) {
      this.logger.error({ err, job: payload }, `Failed job ${jobDef.name}`)
      if (this.driver && payload) {
        const maxAttempts =
          payload.opts?.attempts ?? jobDef.defaultOptions?.attempts ?? 1

        if (payload.attemptsMade < maxAttempts && jobDef.onJobFailed) {
          Promise.resolve(jobDef.onJobFailed(payload, err)).catch(() => {
            /* ignore */
          })
        }

        await this.driver.fail(jobDef, jobId, payload, maxAttempts, err)
      }
    }
  }

  async stop() {
    this.isRunning = false
    if (this.threadPool) {
      await this.threadPool.close()
      this.threadPool = null
    }
    if (this.driver) {
      await this.driver.close()
      this.driver = null
    }
  }
}
