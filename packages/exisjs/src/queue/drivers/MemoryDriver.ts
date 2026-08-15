import type { QueueDriver, JobPayload, JobDefinition } from '../types'

export class MemoryQueueDriver implements QueueDriver {
  private nativeQueue: any
  private fallbackPending = new Map<string, any[]>()
  private fallbackProcessing = new Map<string, any[]>()
  private fallbackDeadLetter = new Map<string, any[]>()
  private isFallback = false

  constructor() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { NativeMemoryQueue } = require('@exisjs/rs')
      this.nativeQueue = new NativeMemoryQueue()
    } catch {
      // Fallback if native module fails to load
      this.isFallback = true
      this.fallbackPending = new Map()
      this.fallbackProcessing = new Map()
      this.fallbackDeadLetter = new Map()
    }
  }

  private getList(map: Map<string, any[]>, key: string): any[] {
    if (!map.has(key)) {
      map.set(key, [])
    }
    return map.get(key)!
  }

  async enqueue(
    name: string,
    payload: JobPayload,
    maxQueue?: number
  ): Promise<string> {
    const score = Date.now() + (payload.opts?.delay || 0)

    if (!this.isFallback) {
      try {
        this.nativeQueue.enqueue(
          name,
          payload.id,
          JSON.stringify(payload),
          score,
          maxQueue
        )
        return payload.id
      } catch (err: any) {
        throw new Error(err.message, { cause: err })
      }
    }

    const pendingList = this.getList(this.fallbackPending!, name)
    if (maxQueue !== undefined && pendingList.length >= maxQueue) {
      throw new Error(
        `Queue backpressure activated: maximum queue size (${maxQueue}) reached for job ${name}.`
      )
    }

    pendingList.push({
      id: payload.id,
      payloadStr: JSON.stringify(payload),
      score,
    })
    pendingList.sort((a, b) => a.score - b.score)

    return payload.id
  }

  async poll(
    jobs: Map<string, JobDefinition>
  ): Promise<{ queueKey: string; jobId: string; payloadStr: string } | null> {
    if (!this.isFallback) {
      const jobNames = Array.from(jobs.keys())
      const visibilityTimeouts = jobNames.map(
        (name) => jobs.get(name)?.defaultOptions?.visibilityTimeout ?? 30000
      )

      const result = this.nativeQueue.poll(jobNames, visibilityTimeouts)
      if (result && result.length === 3) {
        return {
          queueKey: result[0],
          jobId: result[1],
          payloadStr: result[2],
        }
      }
      return null
    }

    const now = Date.now()
    for (const name of jobs.keys()) {
      const pendingList = this.getList(this.fallbackPending!, name)
      if (pendingList.length > 0 && pendingList[0].score <= now) {
        const job = pendingList.shift()!
        const jobDef = jobs.get(name)
        const visibilityTimeout =
          jobDef?.defaultOptions?.visibilityTimeout ?? 30000

        const processingList = this.getList(this.fallbackProcessing!, name)
        processingList.push({
          id: job.id,
          payloadStr: job.payloadStr,
          score: now + visibilityTimeout,
        })

        return {
          queueKey: `memory:${name}:pending`,
          jobId: job.id,
          payloadStr: job.payloadStr,
        }
      }
    }

    return null
  }

  async acknowledge(jobName: string, jobId: string): Promise<void> {
    if (!this.isFallback) {
      this.nativeQueue.acknowledge(jobName, jobId)
      return
    }

    const processingList = this.getList(this.fallbackProcessing!, jobName)
    const index = processingList.findIndex((j) => j.id === jobId)
    if (index !== -1) {
      processingList.splice(index, 1)
    }
  }

  async fail(
    jobDef: JobDefinition,
    jobId: string,
    payload: JobPayload,
    maxAttempts: number,
    error: Error
  ): Promise<void> {
    if (!this.isFallback) {
      const isDeadLetter = payload.attemptsMade >= maxAttempts
      const delay = isDeadLetter ? 0 : (payload.opts?.backoff?.delay ?? 0)
      this.nativeQueue.fail(
        jobDef.name,
        jobId,
        JSON.stringify(payload),
        delay,
        isDeadLetter
      )

      if (isDeadLetter && jobDef.onJobFailedPermanently) {
        Promise.resolve(jobDef.onJobFailedPermanently(payload, error)).catch(
          () => {
            /* noop */
          }
        )
      }
      return
    }

    const processingList = this.getList(this.fallbackProcessing!, jobDef.name)
    const index = processingList.findIndex((j) => j.id === jobId)
    if (index !== -1) {
      processingList.splice(index, 1)
    }

    if (payload.attemptsMade < maxAttempts) {
      const delay = payload.opts?.backoff?.delay ?? 0
      const score = Date.now() + delay

      const pendingList = this.getList(this.fallbackPending!, jobDef.name)
      pendingList.push({
        id: jobId,
        payloadStr: JSON.stringify(payload),
        score,
      })
      pendingList.sort((a, b) => a.score - b.score)
    } else {
      const deadLetterList = this.getList(this.fallbackDeadLetter!, jobDef.name)
      deadLetterList.push({
        id: jobId,
        payloadStr: JSON.stringify(payload),
        score: Date.now(),
      })
      if (jobDef.onJobFailedPermanently) {
        Promise.resolve(jobDef.onJobFailedPermanently(payload, error)).catch(
          () => {
            /* noop */
          }
        )
      }
    }
  }

  async sweep(jobs: Map<string, JobDefinition>): Promise<void> {
    if (!this.isFallback) {
      this.nativeQueue.sweep(Array.from(jobs.keys()))
      return
    }

    const now = Date.now()
    for (const name of jobs.keys()) {
      const processingList = this.getList(this.fallbackProcessing!, name)
      const pendingList = this.getList(this.fallbackPending!, name)

      const expired = processingList.filter((j) => j.score <= now)
      if (expired.length > 0) {
        const remaining = processingList.filter((j) => j.score > now)
        this.fallbackProcessing!.set(name, remaining)

        for (const job of expired) {
          pendingList.push({
            id: job.id,
            payloadStr: job.payloadStr,
            score: now,
          })
        }
        pendingList.sort((a, b) => a.score - b.score)
      }
    }
  }

  async close(): Promise<void> {
    if (!this.isFallback) {
      this.nativeQueue.close()
    } else {
      this.fallbackPending!.clear()
      this.fallbackProcessing!.clear()
    }
  }
}
