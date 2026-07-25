import { definePlugin } from 'exisjs/plugin'
import type { Request, Response, NextFunction } from 'exisjs/router'

export interface MetricsOptions {
  path?: string
}

export const metricsPlugin = definePlugin<MetricsOptions>({
  name: 'metrics-plugin',
  
  // Exis plugins are completely encapsulated by default!
  register: (app, options) => {
    let requestCount = 0

    // 1. This middleware will ONLY run on routes defined inside this plugin.
    app.use((req: Request, res: Response, next: NextFunction) => {
      requestCount++
      next()
    })

    // 2. These routes are grouped and isolated from your main app.
    const endpoint = options?.path || '/metrics'
    app.get(endpoint, (req: Request, res: Response) => {
      res.json({ totalRequests: requestCount })
    })
  },
})
