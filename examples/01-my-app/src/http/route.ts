import { controller, route } from 'exisjs/router'

export default controller({
  welcome: route.get('/', {
    handle() {
      return { message: 'Welcome to Exis!' }
    }
  })
})
