import { Controller, Get } from 'exisjs/decorators'
import mongoose from 'mongoose'

@Controller()
export default class HealthController {
  @Get('/')
  check() {
    const dbStatus =
      mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'

    return {
      status: 'ok',
      database: dbStatus,
      uptime: process.uptime(),
    }
  }
}
