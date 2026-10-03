import { describe, test as it, expect, createTestContext } from 'exisjs/testing'
import appDef from '../src/http/server'
import type { App } from 'exisjs'

describe('Cron Job Integration', () => {
  createTestContext(appDef)
  let app: App

  it('should auto-discover and register cron jobs in app.cron', async () => {
    app = await appDef.boot()
    expect(app.cron).toBeDefined()

    const stats = app.cron.getStats()
    expect(Array.isArray(stats)).toBe(true)

    const jobNames = stats.map((s: any) => s.name)
    expect(jobNames).toContain('nightly-sync')
    expect(jobNames).toContain('system-heartbeat')
  })

  it('should manually trigger a registered cron job', async () => {
    const result = await app.cron.trigger('nightly-sync')
    expect(result).toEqual({ synced: true })
  })

  it('should trigger the interval heartbeat job', async () => {
    const result = await app.cron.trigger('system-heartbeat')
    expect(result).toEqual({ alive: true })
  })
})
