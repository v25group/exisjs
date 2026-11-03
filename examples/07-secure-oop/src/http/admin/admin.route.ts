import { Controller, Get, Public, Roles } from 'exisjs/decorators'
import { User } from '@/database/db'

@Controller()
export default class AdminController {
  @Get('/users')
  @Roles('admin')
  async users() {
    const all = await User.find({}).select('-passwordHash').lean()
    return all.map((u) => ({ email: u.email, role: u.role }))
  }

  // No route rule: only the boundary protects this one
  @Get('/secret')
  @Public()
  secret() {
    return { secret: 'ADMIN_ONLY_SECRET' }
  }
}
