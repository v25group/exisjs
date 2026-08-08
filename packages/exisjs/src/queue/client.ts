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
    const driverType =
      config.driver || (config.redis || config.redisUrl ? 'redis' : null)

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
