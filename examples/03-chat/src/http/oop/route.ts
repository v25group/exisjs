import { Controller, Get, Ws, Socket, Res } from 'exisjs/decorators'
import { ExisWebSocket } from 'exisjs/router'
import type { Response } from 'exisjs/router'
import fs from 'node:fs'
import path from 'node:path'

@Controller()
export default class ChatController {
  @Get('/')
  serveUI(@Res() res: Response) {
    const htmlPath = path.join(process.cwd(), 'public', 'index.html')
    const html = fs.readFileSync(htmlPath, 'utf8')
    res.html(html)
  }

  @Ws('/ws')
  handleSocket(@Socket() socket: ExisWebSocket) {
    // Enable auto-presence for all websocket rooms
    socket.server.enablePresence()

    console.log(`[OOP] New WebSocket connected | id: ${socket.id}`)

    // Listen for incoming messages from the client
    socket.on('message', (rawData: any) => {
      try {
        const data = JSON.parse(rawData.toString())

        if (data.action === 'join') {
          // Attach user data to the native session state!
          socket.data.userId = data.userId

          // Unsubscribe from all previous rooms cleanly
          socket.unsubscribeAll()

          // Join the new room (Auto-presence will automatically emit 'room:join' to everyone else!)
          socket.join(data.room)

          console.log(
            `[OOP] JOIN | user: ${data.userId} | room: #${data.room} | socket: ${socket.id}`
          )

          // Send the full room roster back to the joining user!
          const roster = socket.server.getRoomRoster(data.room)
          socket.emit('roster', { roster })

          console.log(
            `[OOP] ROSTER | room: #${data.room} | online: ${roster.map((r: any) => r.data.userId || r.id).join(', ')}`
          )

          // Send a private welcome to the user
          socket.emit('chat', {
            type: 'system',
            message: `You joined #${data.room}. There are ${roster.length} users online.`,
          })
        } else if (data.action === 'message') {
          console.log(
            `[OOP] MSG | user: ${socket.data.userId} | room: #${data.room} | "${data.message}"`
          )

          socket.publish(
            data.room,
            {
              event: 'chat',
              data: {
                type: 'chat',
                userId: socket.data.userId,
                message: data.message,
              },
            },
            false
          )
        }
      } catch (err) {
        console.error('WebSocket Error:', err)
      }
    })

    socket.on('close', () => {
      console.log(
        `[OOP] LEAVE | user: ${socket.data.userId || 'unknown'} | socket: ${socket.id}`
      )
      socket.unsubscribeAll()
    })
  }
}
