import type { QueueDriver, JobPayload, JobDefinition } from '../types'

interface MemoryJob {
  id: string
  payloadStr: string
  score: number
}

export class MemoryQueueDriver implements QueueDriver {
  private pending = new Map<string, MemoryJob[]>()
  private processing = new Map<string, MemoryJob[]>()

  private getList(map: Map<string, MemoryJob[]>, key: string): MemoryJob[] {
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
    const pendingList = this.getList(this.pending, name)
    if (maxQueue !== undefined && pendingList.length >= maxQueue) {
      throw new Error(
        `Queue backpressure activated: maximum queue size (${maxQueue}) reached for job ${name}.`
      )
    }

    const score = Date.now() + (payload.opts?.delay || 0)
    pendingList.push({
      id: payload.id,
      payloadStr: JSON.stringify(payload),
      score,
    })
    // Keep it sorted by score
    pendingList.sort((a, b) => a.score - b.score)

    return payload.id
  }

  async poll(
    jobs: Map<string, JobDefinition>
  ): Promise<{ queueKey: string; jobId: string; payloadStr: string } | null> {
    const now = Date.now()

    for (const name of jobs.keys()) {
      const pendingList = this.getList(this.pending, name)
      if (pendingList.length > 0 && pendingList[0].score <= now) {
        // Pop the job
        const job = pendingList.shift()!

        const jobDef = jobs.get(name)
        const visibilityTimeout =
          jobDef?.defaultOptions?.visibilityTimeout ?? 30000

        // Move to processing with new score
        const processingList = this.getList(this.processing, name)
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
    const processingList = this.getList(this.processing, jobName)
    const index = processingList.findIndex((j) => j.id === jobId)
    if (index !== -1) {
      processingList.splice(index, 1)
    }
  }

  async fail(
    jobDef: JobDefinition,
    jobId: string,
    payload: JobPayload,
    maxAttempts: number
  ): Promise<void> {
    const processingList = this.getList(this.processing, jobDef.name)
    const index = processingList.findIndex((j) => j.id === jobId)
    if (index !== -1) {
      processingList.splice(index, 1)
    }

    if (payload.attemptsMade < maxAttempts) {
      const delay = payload.opts?.backoff?.delay ?? 0
      const score = Date.now() + delay

      const pendingList = this.getList(this.pending, jobDef.name)
      pendingList.push({
        id: jobId,
        payloadStr: JSON.stringify(payload),
        score,
      })
      pendingList.sort((a, b) => a.score - b.score)
    }
  }

  async sweep(jobs: Map<string, JobDefinition>): Promise<void> {
    const now = Date.now()
    for (const name of jobs.keys()) {
      const processingList = this.getList(this.processing, name)
      const pendingList = this.getList(this.pending, name)

      // Find expired
      const expired = processingList.filter((j) => j.score <= now)
      if (expired.length > 0) {
        // Remove from processing
        const remaining = processingList.filter((j) => j.score > now)
        this.processing.set(name, remaining)

        // Add back to pending
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
    this.pending.clear()
    this.processing.clear()
  }
}
