import { Controller, Get, Post, Body } from 'exisjs/decorators'
import { AdminPostsService } from './service'
// import { CreateAdminPostsSchema } from './schema'

@Controller()
export default class AdminPostsController {
  constructor(private readonly service: AdminPostsService) {}

  @Get('/')
  async list() {
    const result = await this.service.list()
    return { success: true, data: result }
  }

  @Post('/')
  async create(@Body() body: any /* use schema here */) {
    const result = await this.service.create(body)
    return { success: true, data: result }
  }
}
