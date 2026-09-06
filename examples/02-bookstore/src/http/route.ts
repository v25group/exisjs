import { Controller, Get } from 'exisjs/decorators'
import { success } from 'exisjs/response'

@Controller()
export default class RootController {
  @Get('/')
  welcome() {
    return success('Welcome to Exis JS!')
  }
}
