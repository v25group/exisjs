import { Controller, Get } from 'exisjs/decorators'

@Controller()
export default class RootController {
  @Get('/')
  welcome() {
    return { message: 'Welcome to Exis!' }
  }
}
