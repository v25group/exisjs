import { cron, CronExpression } from 'exisjs/cron'

export default cron({
  name: 'daily-cleanup',
  schedule: CronExpression.EVERY_DAY_AT_MIDNIGHT,
  timezone: 'UTC',
  preventOverlap: true,
  async run({ log }) {
    log.info('Running daily cleanup task...')
  },
})
