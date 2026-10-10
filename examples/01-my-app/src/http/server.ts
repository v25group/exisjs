import { exis } from 'exisjs'
import { metricsPlugin } from '@/plugins/metrics'
import '@/config/env' // validate environment variables before anything else

export default exis({
  plugins: [metricsPlugin],

  async onStart(app) {
    // Connect databases, warm caches and register shared providers here.
    app.provide('APP_NAME', { useValue: '01-my-app' })
    app.log.info('Application started')
  },

  async onClose(app) {
    // Release anything ExisJS does not manage (queues, browser sessions...).
    // Databases registered with registerDatabase() are closed automatically.
    app.log.info('Application shutting down')
  },
})
