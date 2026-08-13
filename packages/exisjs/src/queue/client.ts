import type { QueueConfig, JobOptions, JobPayload, QueueDriver } from './types'
import { MemoryQueueDriver } from './drivers/MemoryDriver'
import { RedisQueueDriver } from './drivers/RedisDriver'

export class ExisQueue {
  private driver: QueueDriver | null = null
  private prefix: string
  private maxQueue?: number
  private config: QueueConfig

  constructor(config: QueueConfig) {
    this.config = config
    this.prefix = config.prefix || 'exis:queue'
    this.maxQueue = config.maxQueue

    // Auto-detect driver if not explicitly provided
    let driverType =
      config.driver || (config.redis || config.redisUrl ? 'redis' : null)

    if (process.env.NODE_ENV === 'production') {
      if (driverType === 'memory') {
        console.warn(
          '\x1b[33m[ExisJS] Warning: Queue is explicitly configured to use "memory" driver in production. This is dangerous as jobs will be lost on restart.\x1b[0m'
        )
      } else if (!driverType) {
        if (process.env.REDIS_URL) {
          config.redisUrl = process.env.REDIS_URL
          driverType = 'redis'
        } else {
          console.warn(
            '\x1b[33m[ExisJS] Warning: Queue is enabled without a driver in production. Memory driver will be used, but jobs will be lost on restart. Please set REDIS_URL to automatically use Redis.\x1b[0m'
          )
          driverType = 'memory'
        }
      }
    } else if (!driverType) {
      // Default to memory in development if queue config is present
      driverType = 'memory'
    }

    if (driverType === 'redis') {
      if (config.redis) {
        this.driver = new RedisQueueDriver(config.redis, this.prefix)
      } else if (config.redisUrl) {
        // dynamically import ioredis to ensure it's truly optional
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const IORedis = require('ioredis')
        this.driver = new RedisQueueDriver(
          new IORedis(config.redisUrl),
          this.prefix
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

  get isEnabled() {
    return this.driver !== null
  }

  // Need to expose the driver to the worker
  getDriver(): QueueDriver | null {
    return this.driver
  }

  async enqueue<T>(name: string, data: T, opts?: JobOptions): Promise<string> {
    if (!this.driver) {
      throw new Error(
        `Queue is not configured. Please provide driver: 'memory' | 'redis' in ExisConfig.queue.`
      )
    }

    const id =
      Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9)
    const payload: JobPayload<T> = {
      id,
      name,
      data,
      attemptsMade: 0,
      opts,
    }

    return this.driver.enqueue(name, payload as JobPayload, this.maxQueue)
  }

  async close() {
    if (this.driver) {
      await this.driver.close()
      this.driver = null
    }
  }
}
