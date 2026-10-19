import { controller, route } from 'exisjs/router'
import * as userService from './service'
import { createUserSchema, userParamsSchema } from './schema'

export default controller({
  getUsers: route.get('/', {
    async handle() {
      return userService.getUsers()
    },
  }),

  getUserById: route.get('/:id', {
    params: userParamsSchema,
    async handle({ params }) {
      return userService.getUserById(params.id)
    },
  }),

  createUser: route.post('/', {
    body: createUserSchema,
    async handle({ body }) {
      return userService.createUser(body)
    },
  }),
})
