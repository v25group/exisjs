import { controller, route } from 'exisjs/router'
import { JWT } from 'exisjs/auth'
import { v } from 'exisjs/validator'

// Schema for incoming chat messages
const ChatMessageSchema = v.object({
  text: v.string().min(1).max(500)
})

export default controller({
  chat: route.ws('/:roomId', {
    async handle({ socket, params, req }) {
      const room = params.roomId

      // 1. Authenticate the WebSocket connection (extract token from query or headers)
      const token = req.query.token || req.headers.authorization?.replace('Bearer ', '')
      if (!token || typeof token !== 'string') {
        socket.emit('error', { message: 'Missing authentication token' })
        return socket.close()
      }

      let user: { id: number; role: string; name: string }
      try {
        // Assume JWT payload contains { id, role, name }
        user = JWT.verifyJWT(token, process.env.JWT_SECRET || 'my-super-secret-jwt-key') as any
      } catch (err) {
        socket.emit('error', { message: 'Invalid or expired token' })
        return socket.close()
      }

      // 2. Subscribe to the dynamically requested room
      socket.subscribe(room)

      // 3. Broadcast Presence (excluding sender) using the new Socket.io-like syntax!
      socket.to(room).emit('presence', { 
        event: 'joined', 
        user: user.name,
        timestamp: Date.now()
      })

      // Send a welcome message directly to the connector
      socket.emit('system', { message: `Welcome to the ${room} channel, ${user.name}!` })

      // 4. Listen for named events (strongly typed!)
      socket.onEvent('chat', (data) => {
        try {
          // Validate incoming payload
          const parsed = ChatMessageSchema.parse(data)
          
          // Broadcast to everyone else in the room
          socket.to(room).emit('chat', {
            sender: user.name,
            text: parsed.text,
            timestamp: Date.now()
          })
        } catch (err: any) {
          socket.emit('error', { message: 'Validation failed', errors: err.errors })
        }
      })

      // 5. Cleanup on disconnect
      socket.on('close', () => {
        socket.to(room).emit('presence', { 
          event: 'left', 
          user: user.name,
          timestamp: Date.now()
        })
      })
    }
  })
})
