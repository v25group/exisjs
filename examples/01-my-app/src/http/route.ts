import { controller, route } from 'exisjs/router'

export default controller({
  welcome: route.get('/', {
    summary: 'Welcome message',
    handle() {
      return { message: 'Welcome to ExisJS!' }
    },
  }),
})
