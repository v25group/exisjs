import { defineGateway } from 'exisjs/router'
import { cors, helmet, dedupe, xss, hpp, requestLogger, requestId } from 'exisjs/middleware'
import { intercept, catchError } from 'exisjs/middleware'

export default defineGateway({
  middleware: [
    requestId(),
    requestLogger(),
    helmet(),
    cors({ origin: '*' }),
    xss(),
    dedupe(),
    hpp(),
    
    // Format all successful JSON responses to { success: true, data: ... }
    intercept((data) => {
      if (data && data.error) return data // skip errors
      return { success: true, data }
    })
  ]
})
