import { controller, route } from 'exisjs/router'
import type { Request, ExisSSE } from 'exisjs/router'

export default controller({
  list: route.get('/', {
    handle() {
      return { 
        notifications: [
          { id: 1, message: 'New login detected' }
        ]
      }
    }
  }),
  
  stream: route.sse('/stream', {
    async handle(ctx) {
      const stream = (ctx.req as any).sseStream
      // Simulate real-time notifications to the client
      stream?.send({ event: 'connected', data: { message: 'Listening for notifications...' } })
      
      const interval = setInterval(() => {
        stream?.send({ event: 'notification', data: { message: `Ping at ${Date.now()}` } })
      }, 5000)

      ctx.req.raw.on('close', () => {
        clearInterval(interval)
      })
    }
  })
})
