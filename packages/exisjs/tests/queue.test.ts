import { App } from '../src/server/app'
import RedisMock from 'ioredis-mock'
import { v } from '../src/utils/validator'
import { describe, expect, it, ex, beforeAll, afterAll } from '../src/testing'

const drivers = ['memory', 'redis'] as const

describe('Exis Native Queue', () => {
  for (const driver of drivers) {
    describe(`Driver: ${driver}`, () => {
      it('should initialize without errors and process a job', async () => {
        const redis = driver === 'redis' ? new RedisMock() : undefined

        const app = new App({
          queue: {
            driver,
            redis,
            prefix: 'testq',
          },
        })

        const payloadProcessed = ex.fn()

        // define job
        app.queue(
          'send-email',
          async (job: any) => {
            payloadProcessed(job.data)
          },
          {
            schema: v.object({
              to: v.string(),
              subject: v.string(),
            }),
          }
        )

        // enqueue job
        const jobId = await app.enqueue('send-email', {
          to: 'test@exis.js',
          subject: 'Hello from exis queue',
        })

        expect(jobId).toBeDefined()

        // start app to start the queue
        await new Promise<void>((resolve) => {
          app.listen(0, () => resolve())
        })

        // allow a short tick for queue to process
        await new Promise((resolve) => setTimeout(resolve, 500))

        expect(payloadProcessed).toHaveBeenCalledWith({
          to: 'test@exis.js',
          subject: 'Hello from exis queue',
        })

        await app.close()
      })

      it('should handle job failure and retries', async () => {
        const redis = driver === 'redis' ? new RedisMock() : undefined
        const app = new App({ queue: { driver, redis } })

        let attempts = 0
        app.queue(
          'failing-job',
          async () => {
            attempts++
            throw new Error('Test failure')
          },
          {
            defaultOptions: {
              attempts: 3,
            },
          }
        )

        await app.enqueue('failing-job', { data: 1 })

        await new Promise<void>((resolve) => {
          app.listen(0, () => resolve())
        })

        // wait for retries
        await new Promise((resolve) => setTimeout(resolve, 1000))

        expect(attempts).toBe(3)

        await app.close()
      })

      it('should execute cron jobs via scheduler tick', async () => {
        if (driver !== 'redis') return // Cron is Redis-only in Exis currently

        const redis = new RedisMock()
        const app = new App({ queue: { driver, redis, prefix: 'testq' } })

        let cronTicks = 0
        app.queue(
          'cron-job',
          async () => {
            cronTicks++
          },
          {
            cron: '* * * * *',
          }
        )

        await new Promise<void>((resolve) => {
          app.listen(0, () => resolve())
        })

        // Manually trigger the tick
        const scheduler = (app as any)._cronScheduler
        if (scheduler) {
          await scheduler.tick()
        }

        // Wait for worker to poll and process
        await new Promise((resolve) => setTimeout(resolve, 2000))

        expect(cronTicks).toBe(1)

        await app.close()
      })
    })
  }
})
