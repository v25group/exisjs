import { success } from 'exisjs/response'
import { controller, route } from 'exisjs/router'

export default controller({
  welcome: route.get('/', {
    handle() {
      return success('Welcome to Exis JS!')
    },
  }),
})
