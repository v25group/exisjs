import { controller, route } from 'exisjs/router'
import { requireRole } from 'exisjs/auth'

export default controller({
  middleware: [requireRole(['admin'])],
  
  index: route.get('/', {
    handle() {
      return { secret: 'Admin Dashboard Data' }
    }
  })
})
