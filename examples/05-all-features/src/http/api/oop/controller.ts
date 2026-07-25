import { Controller, Get, Post, Body, Param } from 'exisjs/decorators'
import { UserService } from './service'

@Controller('/users')
export class UserController {
  private userService = new UserService()

  @Get('/:id')
  async getUser(@Param('id') id: string) {
    const user = await this.userService.fetchUser(id)
    return { source: 'oop', user }
  }

  @Post('/batch')
  async getBatchUsers(@Body() body: { ids: string[] }) {
    const users = await this.userService.fetchBatchUsers(body.ids)
    return { source: 'oop', users }
  }
}
