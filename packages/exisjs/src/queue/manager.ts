import type { App } from '../server/app'
import { ExisQueue } from '../queue/client'
import { ExisWorker } from '../queue/worker'
import { CronScheduler } from '../cron/scheduler'
import type { JobOptions } from '../queue/types'
import type { ExisConfig } from '../types'

export class QueueManager {
  public _queueClient: ExisQueue | null = null
  public _queueWorker: ExisWorker | null = null
  public _cronScheduler: CronScheduler | null = null
  public _pendingQueueJobs: import('../queue/types').JobDefinition<unknown>[] =
    []

  constructor(private app: App) {}

  public queue<T = unknown>(
    name: string,
    handler: import('../queue/types').JobHandler<T>,
    options?: Omit<
      import('../queue/types').JobDefinition<T>,
      'name' | 'handler'
    >
  ) {
    if (!this._queueWorker) {
      if (this.app.options.queue?.enableWorkers === false) {
        return
      }
      this._pendingQueueJobs.push({
        name,
        handler: handler as import('../queue/types').JobHandler<unknown>,
        ...options,
      } as any)
      return
    }
    const jobDef = {
      name,
      handler: handler as import('../queue/types').JobHandler<unknown>,
      ...options,
    } as any

    this._queueWorker.registerJob(jobDef)
    if (this._cronScheduler && jobDef.cron) {
      this._cronScheduler.registerJob(jobDef)
    }
  }

  public async enqueue<T = unknown>(
    name: string,
    payload: T,
    opts?: JobOptions
  ): Promise<string> {
    if (!this._queueClient) {
      throw new Error(
        'Queue is not initialized. Please configure ExisConfig.queue first.'
      )
    }
    return this._queueClient.enqueue(name, payload, opts)
  }

  public _initQueue(qConfig: NonNullable<ExisConfig['queue']>) {
    if (!this._queueClient) {
      this._queueClient = new ExisQueue(qConfig)
    }
    const enableWorkers = qConfig.enableWorkers ?? true
    if (enableWorkers && !this._queueWorker) {
      this._queueWorker = new ExisWorker(
        qConfig,
        this.app.log,
        this._queueClient.getDriver()
      )
      this._queueWorker.start()

      const driver = this._queueClient.getDriver()
      const redisClient = driver?.getRedis ? driver.getRedis() : null
      this._cronScheduler = new CronScheduler(
        this._queueWorker,
        redisClient,
        this.app.log,
        qConfig.prefix || 'exis:q'
      )
      this._cronScheduler.start()
    }
  }
}
