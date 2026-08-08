export interface QueueConfig {
  driver?: 'redis' | 'memory'
  redisUrl?: string
  redis?: any
  concurrency?: number
  maxConcurrent?: number
  maxQueue?: number
  enableWorkers?: boolean
  prefix?: string
}

export interface JobOptions {
  attempts?: number
  delay?: number
  visibilityTimeout?: number
  backoff?: {
    type: 'exponential' | 'fixed'
    delay: number
  }
}

export interface JobPayload<T = unknown> {
  id: string
  name: string
  data: T
  attemptsMade: number
  opts?: JobOptions
}

export type JobHandler<T = unknown> = (
  job: JobPayload<T>
) => Promise<void> | void

export interface JobDefinition<T = unknown> {
  name: string
  handler?: JobHandler<T> // Optional when using file-based routing
  filePath?: string // The absolute path to the job file (for worker threads)
  cron?: string // Standard cron expression (e.g. "0 * * * *")
  schema?: { parse: (val: unknown) => T }
  defaultOptions?: JobOptions

  // Observability hooks
  onJobStart?: (payload: JobPayload<T>) => Promise<void> | void
  onJobSuccess?: (payload: JobPayload<T>) => Promise<void> | void
  onJobFailed?: (payload: JobPayload<T>, error: Error) => Promise<void> | void
  onJobFailedPermanently?: (
    payload: JobPayload<T>,
    error: Error
  ) => Promise<void> | void
}

export interface QueueDriver {
  enqueue(name: string, payload: JobPayload, maxQueue?: number): Promise<string>
  poll(
    jobs: Map<string, JobDefinition>
  ): Promise<{ queueKey: string; jobId: string; payloadStr: string } | null>
  acknowledge(jobName: string, jobId: string): Promise<void>
  fail(
    jobDef: JobDefinition,
    jobId: string,
    payload: JobPayload,
    maxAttempts: number,
    error: Error
  ): Promise<void>
  sweep(jobs: Map<string, JobDefinition>): Promise<void>
  close(): Promise<void>
  getRedis?(): any
}
