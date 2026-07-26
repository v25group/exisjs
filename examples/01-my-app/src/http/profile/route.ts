import {
  Controller,
  Get,
  Post,
  Connect,
  Trace,
  Query,
  Use,
  HttpCode,
  Header,
  UseGuards,
  Param,
  Body,
  Ws,
  Sse,
  Socket,
  Stream,
  Req,
} from 'exisjs/decorators'
import { cors } from 'exisjs/middleware'
import { v } from 'exisjs/validator'
import { inject } from 'exisjs/di'
import type { Request, Response, NextFunction } from 'exisjs/router'

// A mock service to demonstrate Dependency Injection
class ProfileService {
  async fetchUser(id: string) {
    return { id, name: 'Alice', role: 'admin' }
  }
}

// A simple guard to demonstrate authorization checks
class SimpleAuthGuard {
  async canActivate(req: Request): Promise<boolean> {
    const authHeader = req.headers['authorization']
    return authHeader === 'Bearer valid-token'
  }
}

@Controller()
// Apply CORS and a custom middleware to ALL routes in this class
@Use(cors({ origin: '*' }))
@Use((req: Request, res: Response, next: NextFunction) => {
  console.log('Profile Controller hit via @Use!')
  next()
})
export default class ProfileController {
  private profileService = inject(ProfileService)

  @Get('/:id', {
    response: v.object({
      success: v.boolean(),
      data: v.object({
        id: v.string(),
        name: v.string(),
        role: v.string(),
      }),
    }),
  })
  async getProfile(@Param('id') id: string) {
    const user = await this.profileService.fetchUser(id)
    return user
  }

  @Post('/update', {
    body: v.object({
      name: v.string(),
      preferences: v.object({
        theme: v.string(),
      }),
    }),
    response: v.object({
      success: v.boolean(),
      message: v.string(),
    }),
  })
  @UseGuards(SimpleAuthGuard)
  @HttpCode(202)
  @Header('X-Custom-Header', 'custom-value')
  async updateProfile(
    @Body() body: { name: string; preferences: { theme: string } }
  ) {
    const newName = body.name
    return {
      success: true,
      message: `Profile updated perfectly for ${newName}`,
    }
  }

  @Connect('/stream')
  async connectStream(req: Request) {
    return { success: true, message: 'Connected to profile stream' }
  }

  @Trace('/debug')
  async traceDebug(req: Request) {
    return { success: true, traceId: req.headers['x-trace-id'] || 'none' }
  }

  @Query('/search')
  async searchProfile(req: Request) {
    return { success: true, message: 'Profile search endpoint' }
  }

  @Ws('/chat')
  async chatStream(
    @Socket() socket: import('exisjs/router').ExisWebSocket,
    @Req() req: Request
  ) {
    socket.subscribe('profile-chat')
    socket.publish('profile-chat', { message: 'A new user joined the chat!' })

    socket.onEvent('message', (payload) => {
      socket.send({ received: true, payload })
    })
  }

  @Sse('/live-updates')
  async liveUpdates(@Stream() stream: import('exisjs/router').ExisSSE) {
    stream.send({ message: 'Connected to live profile updates' })
    let ticks = 0

    const interval = setInterval(() => {
      if (!stream.connected) {
        clearInterval(interval)
        return
      }
      stream.send({ tick: ++ticks }, 'update')
    }, 1000)

    setTimeout(() => {
      clearInterval(interval)
      stream.close()
    }, 3000)
  }
}
