import type { JobDefinition } from '../queue/types'
import { parseCronExpression } from './parser'
import type Redis from 'ioredis'
import type { ExisWorker } from '../queue/worker'
import type { LogFn } from '../types'

export class CronScheduler {
  private jobs: JobDefinition[] = []
  private timer: NodeJS.Timeout | null = null
  private redis: Redis | null = null
  private worker: ExisWorker | null = null
  private logger: { error: LogFn; info: LogFn; debug: LogFn }
  private prefix = 'exis:cron'

  private queuePrefix: string

  constructor(
    worker: ExisWorker | null,
    redis: Redis | null,
    logger: { error: LogFn; info: LogFn; debug: LogFn },
    queuePrefix = 'exis:q'
  ) {
    this.worker = worker
    this.redis = redis
    this.logger = logger
    this.queuePrefix = queuePrefix
  }

  registerJob(job: JobDefinition) {
    if (job.cron) {
      this.jobs.push(job)
      if (!process.env.__EXIS_IS_RESTART) {
        this.logger.info(`Scheduled cron job ${job.name} (${job.cron})`)
      }
    }
  }

  start() {
    if (this.jobs.length === 0) return

    if (!this.worker) {
      this.logger.error('CronScheduler cannot start: Queue Worker is disabled.')
      return
    }

    // Align to the next exact minute
    const now = new Date()
    const msUntilNextMinute =
      60000 - (now.getSeconds() * 1000 + now.getMilliseconds())

    this.timer = setTimeout(() => {
      this.tick()
      // Now run exactly every 60 seconds
      this.timer = setInterval(() => this.tick(), 60000)
      this.timer.unref?.()
    }, msUntilNextMinute)
    this.timer.unref?.()
  }

  private async tick() {
    const now = new Date()
    // Zero out seconds/milliseconds for precise cron matching
    now.setSeconds(0, 0)

    for (const job of this.jobs) {
      if (!job.cron) continue

      try {
        if (parseCronExpression(job.cron, now)) {
          // If Redis is configured, use SETNX to acquire a lock for this minute
          // This guarantees that across a 10-server cluster, the job only runs ONCE.
          let shouldRun = true

          if (this.redis) {
            const lockKey = `${this.prefix}:lock:${job.name}:${now.getTime()}`
            // Lock expires in 55 seconds to clean itself up
            const acquired = await this.redis.set(
              lockKey,
              'locked',
              'EX',
              55,
              'NX'
            )
            if (!acquired) {
              shouldRun = false
            }
          }

          if (shouldRun) {
            this.logger.debug(`Triggering cron job: ${job.name}`)
            // We just enqueue an empty object for cron triggers!
            const id =
              Date.now().toString() +
              '-' +
              Math.random().toString(36).substring(2, 9)

            if (this.redis) {
              const payload = {
                id,
                name: job.name,
                data: {},
                attemptsMade: 0,
              }
              const zsetKey = `${this.queuePrefix}:${job.name}:pending`
              const hashKey = `${this.queuePrefix}:${job.name}:payloads`
              const payloadStr = JSON.stringify(payload)
              const score = Date.now()

              const luaScript = `
                redis.call("ZADD", KEYS[1], ARGV[1], ARGV[2])
                redis.call("HSET", KEYS[2], ARGV[2], ARGV[3])
                return 1
              `
              await this.redis.eval(
                luaScript,
                2,
                zsetKey,
                hashKey,
                score,
                payload.id,
                payloadStr
              )
            } else if (this.worker) {
              // Fallback for completely memory-based setups without Redis
              // We'll directly invoke the worker processJob method (but it's private...)
              // Since worker poll reads from Redis, if they don't have Redis they shouldn't be using cron.
              // We will just throw an error if no redis but has worker.
              // Wait, they can use cron locally! We can expose a trigger method on the worker or threadpool.
              // Actually, ExisWorker is designed to be Redis-backed.
              // We can just log an error if Redis is not configured but they are trying to run cron.
              this.logger.error(
                `Cron requires Redis to distribute the queue payload for ${job.name}.`
              )
            }
          }
        }
      } catch (err: any) {
        this.logger.error(
          `Failed to parse cron for ${job.name}: ${err.message}`
        )
      }
    }
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer)
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
