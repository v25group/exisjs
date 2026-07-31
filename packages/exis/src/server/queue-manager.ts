import type { App } from './app'
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
    this._queueWorker.registerJob({
      name,
      handler: handler as import('../queue/types').JobHandler<unknown>,
      ...options,
    } as any)
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

      const redisClient = (this._queueWorker as any).redis || null
      this._cronScheduler = new CronScheduler(
        this._queueWorker,
        redisClient,
        this.app.log
      )
      this._cronScheduler.start()
    }
  }
}
