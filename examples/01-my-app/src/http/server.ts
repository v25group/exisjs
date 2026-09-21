import { exis } from 'exisjs'
import { metricsPlugin } from '@/plugins/metrics'
import { intercept, catchError } from 'exisjs/middleware'

// A custom exception class for our app
export class DatabaseConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseConnectionError'
  }
}

export default exis({
  plugins: [metricsPlugin],
  async onStart(app) {
    // Register DI providers
    app.provide('DATABASE_URL', { useValue: 'postgres://localhost:5432/mydb' })
    app.provide('LoggerService', {
      useFactory: () => ({
        log: (msg: string) => console.log(`[LoggerService]: ${msg}`),
      }),
    })

    // 1. Connect to your database
    // await db.connect()

    // Wrap all responses in a { success: true, data: ... } format using the new Interceptor
    app.use(
      intercept((data) => {
        if (data && data.error) return data // skip errors
        return { success: true, data }
      })
    )

    // Exception Filter: Catch ONLY DatabaseConnectionError specifically
    app.use(
      catchError(DatabaseConnectionError, (err, req, res) => {
        res.status(503).json({
          success: false,
          error: { code: 'DB_OFFLINE', message: err.message },
        })
      })
    )
  },

  async onClose(app) {
    // Gracefully close database connections here
    // await db.disconnect()
    console.log(
      '[onClose Hook]: Gracefully disconnecting database & releasing resources...'
    )
  },
})
