import type Redis from 'ioredis'
import type { QueueDriver, JobPayload, JobDefinition } from '../types'

export class RedisQueueDriver implements QueueDriver {
  private redis: Redis
  private prefix: string

  constructor(redis: Redis, prefix = 'exis:queue') {
    this.redis = redis
    this.prefix = prefix
  }

  async enqueue(
    name: string,
    payload: JobPayload,
    maxQueue?: number
  ): Promise<string> {
    const zsetKey = `${this.prefix}:${name}:pending`
    const hashKey = `${this.prefix}:${name}:payloads`
    const payloadStr = JSON.stringify(payload)
    const score = Date.now() + (payload.opts?.delay || 0)

    if (maxQueue !== undefined) {
      const luaScript = `
        local len = redis.call("ZCARD", KEYS[1])
        if len >= tonumber(ARGV[1]) then
          return -1
        end
        redis.call("ZADD", KEYS[1], ARGV[2], ARGV[3])
        redis.call("HSET", KEYS[2], ARGV[3], ARGV[4])
        return 1
      `
      const result = await this.redis.eval(
        luaScript,
        2,
        zsetKey,
        hashKey,
        maxQueue,
        score,
        payload.id,
        payloadStr
      )
      if (result === -1) {
        throw new Error(
          `Queue backpressure activated: maximum queue size (${maxQueue}) reached for job ${name}.`
        )
      }
    } else {
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
    }

    return payload.id
  }

  async poll(
    jobs: Map<string, JobDefinition>
  ): Promise<{ queueKey: string; jobId: string; payloadStr: string } | null> {
    const now = Date.now()

    for (const name of jobs.keys()) {
      const pendingKey = `${this.prefix}:${name}:pending`
      const processingKey = `${this.prefix}:${name}:processing`
      const hashKey = `${this.prefix}:${name}:payloads`

      const jobDef = jobs.get(name)
      const visibilityTimeout =
        jobDef?.defaultOptions?.visibilityTimeout ?? 30000

      const luaScript = `
        local jobs = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", ARGV[1], "LIMIT", 0, 1)
        if #jobs > 0 then
          local id = jobs[1]
          redis.call("ZREM", KEYS[1], id)
          redis.call("ZADD", KEYS[2], ARGV[2], id)
          local payload = redis.call("HGET", KEYS[3], id)
          return { id, payload }
        end
        return nil
      `
      const res = (await this.redis.eval(
        luaScript,
        3,
        pendingKey,
        processingKey,
        hashKey,
        now,
        now + visibilityTimeout
      )) as any[] | null

      if (res && res[0] && res[1]) {
        return {
          queueKey: pendingKey,
          jobId: res[0] as string,
          payloadStr: res[1] as string,
        }
      }
    }

    return null
  }

  async acknowledge(jobName: string, jobId: string): Promise<void> {
    const processingKey = `${this.prefix}:${jobName}:processing`
    const hashKey = `${this.prefix}:${jobName}:payloads`
    await this.redis
      .pipeline()
      .zrem(processingKey, jobId)
      .hdel(hashKey, jobId)
      .exec()
  }

  async fail(
    jobDef: JobDefinition,
    jobId: string,
    payload: JobPayload,
    maxAttempts: number
  ): Promise<void> {
    const processingKey = `${this.prefix}:${jobDef.name}:processing`
    const pendingKey = `${this.prefix}:${jobDef.name}:pending`
    const hashKey = `${this.prefix}:${jobDef.name}:payloads`

    if (payload.attemptsMade < maxAttempts) {
      const delay = payload.opts?.backoff?.delay ?? 0
      const nextRun = Date.now() + delay

      await this.redis
        .pipeline()
        .hset(hashKey, jobId, JSON.stringify(payload))
        .zrem(processingKey, jobId)
        .zadd(pendingKey, nextRun, jobId)
        .exec()
    } else {
      await this.redis
        .pipeline()
        .zrem(processingKey, jobId)
        .hdel(hashKey, jobId)
        .exec()
    }
  }

  async sweep(jobs: Map<string, JobDefinition>): Promise<void> {
    for (const name of jobs.keys()) {
      const processingKey = `${this.prefix}:${name}:processing`
      const pendingKey = `${this.prefix}:${name}:pending`

      const luaScript = `
        local expired = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
        for i, id in ipairs(expired) do
          redis.call("ZREM", KEYS[1], id)
          redis.call("ZADD", KEYS[2], ARGV[1], id)
        end
        return #expired
      `
      await this.redis.eval(luaScript, 2, processingKey, pendingKey, Date.now())
    }
  }

  async close(): Promise<void> {
    await this.redis.quit()
  }
}
