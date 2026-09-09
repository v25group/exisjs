import { controller, route } from 'exisjs/router'
import { BroadcastSchema, type BroadcastDto } from './events.schema'
import * as eventsService from './events.service'

export default controller({
  // Real-time SSE stream endpoint
  liveStream: route.get('/live', {
    handle: async ({ res }) => {
      let intervalId: NodeJS.Timeout | null = null

      res.sse((sse) => {
        const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        
        // 1. Send initial handshake
        sse.send({
          event: 'connected',
          data: {
            clientId,
            connectedAt: new Date().toISOString(),
            status: 'online',
          },
        })

        // 2. Register for broadcast notifications
        const unregister = eventsService.registerClient(sse)

        // 3. Emit regular heartbeat metrics every 2 seconds
        intervalId = setInterval(() => {
          sse.send({
            event: 'ticker',
            data: {
              time: Date.now(),
              cpu: (Math.random() * 10 + 5).toFixed(1),
              memory: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
              latency: (Math.random() * 5 + 1).toFixed(1),
              activeSubscribers: eventsService.getActiveCount(),
            },
          })
        }, 2000)

        // 4. Cleanup on client disconnect
        sse.onClose(() => {
          if (intervalId) clearInterval(intervalId)
          unregister()
        })
      })
    },
  }),

  // Broadcast an event to all live SSE subscribers
  broadcast: route.post('/broadcast', {
    body: BroadcastSchema,
    handle: async ({ body }) => {
      const payload = body as BroadcastDto
      eventsService.broadcast('broadcast', {
        message: payload.message,
        timestamp: Date.now(),
      })

      return {
        success: true,
        sentTo: eventsService.getActiveCount(),
      }
    },
  }),

  // Get active subscriber metrics
  stats: route.get('/stats', {
    handle: async () => {
      return {
        activeSubscribers: eventsService.getActiveCount(),
        uptime: process.uptime(),
      }
    },
  }),
})
