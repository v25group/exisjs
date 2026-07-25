import { defineJob } from 'exisjs/queue'

export default defineJob({
  name: 'cleanup',
  cron: '* * * * *', // Run every single minute for testing purposes
  handler: async () => {
    console.log('[Cron Job] Cleaning up stale database records...')
    // Simulating database work
    await new Promise(r => setTimeout(r, 1000))
    console.log('[Cron Job] Cleanup completed successfully.')
  }
})
