import { exis } from 'exisjs'
import { logger } from 'exisjs/logger'
import { metricsPlugin } from '../plugins/metrics'
import { catchError } from 'exisjs/middleware'

export default exis({
  async onStart(app) {
    logger.info('Starting up...')

    // 1. Demonstrate Dependency Injection
    app.provide('API_VERSION', { useValue: 'v1.0.0' })
    app.provide('LoggerService', {
      useFactory: () => {
        return { log: (msg: string) => logger.debug({ service: 'LoggerService' }, msg) }
      },
    })

    // 2. Register Global Middlewares
    // Global Catch-All Error Handler
    app.use(
      catchError(Error, (err, req, res) => {
        logger.error({ err }, 'Unhandled error')
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: err.message },
        })
      })
    )

    // 3. Register Plugins
    metricsPlugin.register(app, { path: '/api/metrics' })

    logger.info('Setup complete')
  },

  async onClose(app) {
    logger.warn('Shutting down gracefully...')
  },
})
