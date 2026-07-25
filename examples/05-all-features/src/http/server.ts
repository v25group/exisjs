import { exis } from 'exisjs'
import { serveSwagger } from 'exisjs/swagger'
import { metricsPlugin } from '../plugins/metrics'
import { loaderMiddleware } from '../loaders'
import { catchError } from 'exisjs/middleware'

export default exis({
  async onStart(app) {
    console.log('[App] Starting up...')

    // 1. Demonstrate Dependency Injection
    app.provide('API_VERSION', { useValue: 'v1.0.0' })
    app.provide('LoggerService', { 
      useFactory: () => {
        return { log: (msg: string) => console.log(`[LoggerService] ${msg}`) }
      }
    })

    // 2. Register Global Middlewares & Loaders
    app.use(loaderMiddleware)

    // Global Catch-All Error Handler
    app.use(catchError(Error, (err, req, res) => {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err.message }
      })
    }))

    // 3. Register Plugins
    metricsPlugin.register(app, { path: '/api/metrics' })

    // 4. Setup Swagger UI
    serveSwagger(app, { title: 'ExisJS Kitchen Sink API', version: '1.0.0' })
    
    console.log('[App] Setup complete.')
  },

  async onClose(app) {
    console.log('[App] Shutting down gracefully...')
  },
})
