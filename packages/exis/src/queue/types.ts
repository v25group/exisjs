import type Redis from 'ioredis'

export interface QueueConfig {
  driver?: 'redis' | 'memory' | 'database'
  redisUrl?: string
  redis?: Redis
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
    maxAttempts: number
  ): Promise<void>
  sweep(jobs: Map<string, JobDefinition>): Promise<void>
  close(): Promise<void>
}
