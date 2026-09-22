import { describe, it, expect, beforeEach, afterEach } from '../src/testing'
import { App } from '../src/server/app'
import { Injectable } from '../src/decorators/core'
import { Inject } from '../src/di'
import {
  Cron,
  Interval,
  TimeoutTask,
  getCronJobsFromClass,
} from '../src/decorators/cron'

describe('Class-Based (OOP) Cron & Scheduled Decorators', () => {
  let app: App

  beforeEach(() => {
    app = new App()
  })

  afterEach(() => {
    app.cron.stopAll()
  })

  it('stores metadata on class prototype with @Cron, @Interval, @TimeoutTask', () => {
    @Injectable()
    class SampleJob {
      @Cron('0 0 * * *', { name: 'nightly-purge', preventOverlap: true })
      async purge() {}

      @Interval(30000, { name: 'heartbeat' })
      async ping() {}

      @TimeoutTask(5000, { name: 'warmup' })
      async init() {}
    }

    const registry = getCronJobsFromClass(SampleJob)
    expect(Array.isArray(registry)).toBe(true)
    expect(registry.length).toBe(3)

    const purgeMeta = registry.find((r: any) => r.methodName === 'purge')
    expect(purgeMeta?.options.schedule).toBe('0 0 * * *')
    expect(purgeMeta?.options.name).toBe('nightly-purge')
    expect(purgeMeta?.options.preventOverlap).toBe(true)

    const intervalMeta = registry.find((r: any) => r.methodName === 'ping')
    expect(intervalMeta?.options.interval).toBe(30000)

    const timeoutMeta = registry.find((r: any) => r.methodName === 'init')
    expect(timeoutMeta?.options.timeout).toBe(5000)
    expect(timeoutMeta?.options.name).toBe('warmup')
  })

  it('resolves dependencies and registers class methods with app.cron', async () => {
    @Injectable()
    class DatabaseLogger {
      public logs: string[] = []
      log(msg: string) {
        this.logs.push(msg)
      }
    }

    @Injectable()
    class BackupJob {
      public dbLogger: DatabaseLogger
      constructor(dbLogger: DatabaseLogger) {
        this.dbLogger = dbLogger
      }

      @Cron('0 12 * * *', { name: 'db-backup', autoStart: false })
      async backupDatabase() {
        this.dbLogger.log('Database backup completed')
        return { backupSize: '50MB' }
      }
    }
    Inject(DatabaseLogger)(BackupJob, undefined, 0)

    app.container.provide(DatabaseLogger, { useClass: DatabaseLogger })
    app.container.provide(BackupJob, { useClass: BackupJob })

    const backupInstance = app.container.resolve<BackupJob>(BackupJob)
    const decoratedJobs = getCronJobsFromClass(BackupJob)

    for (const jobMeta of decoratedJobs) {
      app.cron.schedule({
        ...jobMeta.options,
        run: (backupInstance as any)[jobMeta.methodName].bind(backupInstance),
      })
    }

    expect(app.cron.has('db-backup')).toBe(true)
    const result = await app.cron.trigger('db-backup')

    expect(result).toEqual({ backupSize: '50MB' })
    const loggerInstance = app.container.resolve<DatabaseLogger>(DatabaseLogger)
    expect(loggerInstance.logs).toContain('Database backup completed')
  })
})
