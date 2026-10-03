import { cron, CronExpression } from 'exisjs/cron'

export const nightlySync = cron({
  name: 'nightly-sync',
  schedule: CronExpression.EVERY_DAY_AT_MIDNIGHT,
  timezone: 'UTC',
  preventOverlap: true,
  retries: 2,
  retryDelayMs: 1000,
  async run({ log }) {
    log.info('Executing nightly sync job')
    return { synced: true }
  },
  onError(err, { log }) {
    log.error({ err }, 'Sync failed')
  }
})

export const heartbeat = cron.interval(10_000, async ({ log }) => {
  log.info('System heartbeat')
  return { alive: true }
}, {
  name: 'system-heartbeat'
})
