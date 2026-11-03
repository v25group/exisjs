import { Controller, Get, Public } from 'exisjs/decorators'

@Controller()
export default class HealthController {
  @Get('/')
  @Public()
  health() {
    return { status: 'ok' }
  }
}
