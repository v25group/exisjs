import { defineBoundary } from 'exisjs/router'
import { cors, helmet, dedupe, hpp, requestLogger, requestId } from 'exisjs/middleware'
import { intercept } from 'exisjs/middleware'

export const config = defineBoundary({
  cors: { origin: '*' },
  headers: { 'X-Powered-By': 'ExisJS' },
  middleware: [
    requestId(),
    requestLogger(),
    helmet(),
    dedupe({ keyGenerator: (req) => `${req.method}:${req.url}:${req.headers['x-request-id'] || req.socket?.remoteAddress}` }),
    hpp(),

    // Format all successful JSON responses to { success: true, data: ... }
    intercept((data) => {
      if (data && data.error) return data // skip errors
      return { success: true, data }
    })
  ]
})
