import { Server } from 'exisjs/decorators'
import type { App } from 'exisjs'
import { serveSwagger } from 'exisjs/swagger'
import { metricsPlugin } from '@/plugins/metrics'
import { loaderMiddleware } from '../loaders'
import { intercept, catchError } from 'exisjs/middleware'
import { queue } from 'exisjs/queue'

// A custom exception class for our app
export class DatabaseConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseConnectionError'
  }
}

@Server({
  plugins: [metricsPlugin],
  providers: [
    ['DATABASE_URL', { useValue: 'postgres://localhost:5432/mydb' }],
    ['LoggerService', {
      useFactory: () => {
        return { log: (msg: string) => console.log(`[LoggerService]: ${msg}`) }
      }
    }]
  ]
})
export default class RootServer {
  async onStart(app: App) {
    // 1. Connect to your database
    // await db.connect()

    // 2. Register plugins and middleware
    app.use(loaderMiddleware)

    // Wrap all responses in a { success: true, data: ... } format using the new Interceptor
    app.use(
      intercept((data) => {
        if (data && data.error) return data // skip errors
        return { success: true, data }
      })
    )

    // Inline Queue Handler: Listen for the 'welcome-email' job dispatched by auth/route.ts
    queue<{ name: string; email: string }>(
      'welcome-email',
      async (job) => {
        console.log(
          `[QUEUE] Sending welcome email to ${job.data.name} <${job.data.email}>...`
        )
        // Simulate sending email
        await new Promise((resolve) => setTimeout(resolve, 1000))
        console.log(`[QUEUE] Welcome email sent to ${job.data.email}!`)
      },
      {
        defaultOptions: { attempts: 3 },
      }
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

    serveSwagger(app, { title: 'My App API', version: '1.0.0' })
    // The Exis CLI automatically boots the server and file-system routes
  }

  async onClose(app: App) {
    // Gracefully close database connections here
    // await db.disconnect()
  }
}

