import { defineJob } from 'exisjs/queue'

export default defineJob({
  name: 'cleanup',
  cron: '* * * * *', // Run every minute
  handler: async () => {
    console.log(`[Cron Job: cleanup] Executing cleanup job at ${new Date().toISOString()}`)
    await new Promise(r => setTimeout(r, 500))
    console.log('[Cron Job: cleanup] Cleanup completed.')
  }
})
