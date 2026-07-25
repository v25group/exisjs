import { definePlugin } from 'exisjs/plugin'
import type { Request, Response, NextFunction } from 'exisjs/router'

export interface MetricsOptions {
  path?: string
}

export const metricsPlugin = definePlugin<MetricsOptions>({
  name: 'metrics-plugin',
  
  register: (app, options) => {
    let requestCount = 0

    // Plugin local middleware
    app.use((req: Request, res: Response, next: NextFunction) => {
      requestCount++
      next()
    })

    const endpoint = options?.path || '/metrics'
    app.get(endpoint, (req: Request, res: Response) => {
      res.json({ totalRequests: requestCount, uptime: process.uptime() })
    })
  },
})
