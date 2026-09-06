import { controller, route } from 'exisjs/router'

export default controller({
  list: route.get('/', {
    handle() {
      return {
        notifications: [{ id: 1, message: 'New login detected' }],
      }
    },
  }),
})
