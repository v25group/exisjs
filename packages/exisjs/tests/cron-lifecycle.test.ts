import { describe, it, expect, beforeEach, afterEach } from '../src/testing'
import { App } from '../src/server/app'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

describe('Cron File-Convention Discovery & Graceful Shutdown', () => {
  let app: App
  let tmpDir: string
  const cronIndexPath = path
    .join(__dirname, '../src/cron/index')
    .replace(/\\/g, '/')
  const decoratorsPath = path
    .join(__dirname, '../src/decorators/index')
    .replace(/\\/g, '/')

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'exis-cron-test-'))
  })

  afterEach(async () => {
    if (app) app.cron.stopAll()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('automatically discovers and mounts functional cron files from src/cron/', async () => {
    const cronDir = path.join(tmpDir, 'src', 'cron')
    await fs.mkdir(cronDir, { recursive: true })

    await fs.writeFile(
      path.join(cronDir, 'sync.js'),
      `
      const { cron } = require('${cronIndexPath}')
      exports.default = cron({
        name: 'user-sync-job',
        schedule: '0 0 * * *',
        autoStart: false,
        run: async () => {
          return { synced: 100 }
        }
      })
      `
    )

    app = new App()
    await app.autoMountRoutes(tmpDir)

    expect(app.cron.has('user-sync-job')).toBe(true)
    const result = await app.cron.trigger('user-sync-job')
    expect(result).toEqual({ synced: 100 })
  })

  it('automatically discovers and mounts class-based cron jobs from src/cron/', async () => {
    const cronDir = path.join(tmpDir, 'src', 'cron')
    await fs.mkdir(cronDir, { recursive: true })

    await fs.writeFile(
      path.join(cronDir, 'cleanup.job.js'),
      `
      const { Cron } = require('${decoratorsPath}')
      class CleanupJob {
        async purge() {
          return { purgedRows: 42 }
        }
      }
      Cron('0 2 * * *', { name: 'auto-purge', autoStart: false })(
        CleanupJob.prototype,
        'purge',
        Object.getOwnPropertyDescriptor(CleanupJob.prototype, 'purge')
      )
      exports.default = CleanupJob
      `
    )

    app = new App()
    await app.autoMountRoutes(tmpDir)

    expect(app.cron.has('auto-purge')).toBe(true)
    const result = await app.cron.trigger('auto-purge')
    expect(result).toEqual({ purgedRows: 42 })
  })

  it('automatically discovers multiple jobs in single src/http/cron.js file', async () => {
    const httpDir = path.join(tmpDir, 'src', 'http')
    await fs.mkdir(httpDir, { recursive: true })

    await fs.writeFile(
      path.join(httpDir, 'cron.js'),
      `
      const { cron } = require('${cronIndexPath}')
      exports.jobOne = cron({
        name: 'http-cron-1',
        schedule: '0 * * * *',
        autoStart: false,
        run: async () => ({ id: 1 })
      })
      exports.jobTwo = cron({
        name: 'http-cron-2',
        schedule: '0 0 * * *',
        autoStart: false,
        run: async () => ({ id: 2 })
      })
      `
    )

    app = new App()
    await app.autoMountRoutes(tmpDir)

    expect(app.cron.has('http-cron-1')).toBe(true)
    expect(app.cron.has('http-cron-2')).toBe(true)
    const res1 = await app.cron.trigger('http-cron-1')
    const res2 = await app.cron.trigger('http-cron-2')
    expect(res1).toEqual({ id: 1 })
    expect(res2).toEqual({ id: 2 })
  })

  it('drains in-flight cron executions cleanly on server shutdown', async () => {
    app = new App()
    let drainedSuccessfully = false

    const job = app.cron.schedule({
      name: 'long-running-job',
      schedule: '* * * * *',
      autoStart: false,
      run: async () => {
        await new Promise((r) => setTimeout(r, 60))
        drainedSuccessfully = true
      },
    })

    // Start background execution
    const runPromise = job.trigger()

    // Initiate drain
    await app.cron.drain(1000)
    await runPromise

    expect(drainedSuccessfully).toBe(true)
    expect(job.getStatus()).toBe('stopped')
  })
})
