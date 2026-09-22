import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '../src/testing/index'
import { App } from '../src/server/app'
import { cron } from '../src/cron/manager'

describe('Cron Execution, Overlap Prevention & Resilience', () => {
  let app: App

  beforeEach(() => {
    app = new App()
  })

  afterEach(() => {
    app.cron.stopAll()
  })

  describe('Scheduling & Manual Triggers', () => {
    it('executes scheduled cron job and tracks stats', async () => {
      let executed = false
      let receivedIteration = 0

      const job = app.cron.schedule({
        name: 'test-sync',
        schedule: '* * * * *',
        autoStart: false,
        run: async ({ iteration }) => {
          executed = true
          receivedIteration = iteration
          return { done: true }
        },
      })

      expect(job.name).toBe('test-sync')
      expect(job.getStatus()).toBe('idle')

      const result = await job.trigger()
      expect(result).toEqual({ done: true })
      expect(executed).toBe(true)
      expect(receivedIteration).toBe(1)

      const stats = job.getStats()
      expect(stats.executionCount).toBe(1)
      expect(stats.failureCount).toBe(0)
      expect(stats.lastDurationMs).toBeDefined()
    })

    it('supports pause and resume controls', () => {
      const job = app.cron.schedule('pause-test', '* * * * *', () => {})
      expect(job.getStatus()).toBe('idle')

      job.pause()
      expect(job.getStatus()).toBe('paused')
      expect(job.getStats().nextRun).toBeUndefined()

      job.resume()
      expect(job.getStatus()).toBe('idle')
      expect(job.getStats().nextRun).toBeDefined()
    })
  })

  describe('Concurrent Overlap Prevention (preventOverlap: true)', () => {
    it('prevents simultaneous executions when a job takes longer than its interval', async () => {
      let activeExecutions = 0
      let maxConcurrent = 0
      let totalRuns = 0

      const job = app.cron.schedule({
        name: 'overlap-job',
        schedule: '* * * * *',
        preventOverlap: true,
        autoStart: false,
        run: async () => {
          activeExecutions++
          totalRuns++
          if (activeExecutions > maxConcurrent) {
            maxConcurrent = activeExecutions
          }
          await new Promise((r) => setTimeout(r, 60))
          activeExecutions--
        },
      })

      // Trigger parallel executions simultaneously
      await Promise.all([job.trigger(), job.trigger(), job.trigger()])

      expect(maxConcurrent).toBe(1)
      expect(totalRuns).toBe(1) // overlapping triggers were skipped
    })
  })

  describe('Error Sandbox & Resilience', () => {
    it('isolates errors without crashing and records failure statistics', async () => {
      let errorHookTriggered = false
      let capturedErrorMessage = ''

      const job = app.cron.schedule({
        name: 'failing-job',
        schedule: '* * * * *',
        autoStart: false,
        run: async () => {
          throw new Error('Database disconnected')
        },
        onError: async (err) => {
          errorHookTriggered = true
          capturedErrorMessage = err.message
        },
      })

      // Trigger should safely resolve without throwing out to caller
      await job.trigger()

      expect(errorHookTriggered).toBe(true)
      expect(capturedErrorMessage).toBe('Database disconnected')

      const stats = job.getStats()
      expect(stats.executionCount).toBe(1)
      expect(stats.failureCount).toBe(1)
      expect(stats.lastError).toBe('Database disconnected')
    })

    it('supports retry logic on transient failures', async () => {
      let attempts = 0

      const job = app.cron.schedule({
        name: 'retry-job',
        schedule: '* * * * *',
        autoStart: false,
        retries: 2,
        retryDelayMs: 20,
        run: async () => {
          attempts++
          if (attempts < 3) {
            throw new Error('Temporary network glitch')
          }
          return 'success_after_retries'
        },
      })

      const result = await job.trigger()
      expect(result).toBe('success_after_retries')
      expect(attempts).toBe(3)
      expect(job.getStats().failureCount).toBe(0)
    })
  })

  describe('Interval and Timeout Task Helpers', () => {
    it('runs one-time timeout task', async () => {
      let timeoutRan = false
      app.cron.timeout('one-time-task', 15, async () => {
        timeoutRan = true
      })

      await new Promise((r) => setTimeout(r, 45))
      expect(timeoutRan).toBe(true)
    })

    it('runs recurring interval task', async () => {
      let tickCount = 0
      app.cron.interval('recurring-interval', 25, async () => {
        tickCount++
      })

      await new Promise((r) => setTimeout(r, 120))
      expect(tickCount).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Functional Definition Helper (cron API)', () => {
    it('creates a typed functional cron definition object', () => {
      const def = cron('0 0 * * *', async () => {})
      expect(def.__isExisCron).toBe(true)
      expect(def.options.schedule).toBe('0 0 * * *')
      expect(typeof def.handler).toBe('function')
    })
  })
})
