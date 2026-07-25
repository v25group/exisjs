import { controller, route } from 'exisjs/router'

export default controller({
  check: route.get('/', {
    handle() {
      return { 
        status: 'ok',
        timestamp: new Date().toISOString()
      }
    }
  })
})
