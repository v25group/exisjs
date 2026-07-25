import { controller, route } from 'exisjs/router'
import { UserParamsSchema, UserBatchSchema } from './schema'
import { getUserHandler, getBatchUsersHandler } from './controller'

export default controller({
  getUsers: route.get('/users/:id', {
    params: UserParamsSchema,
    handle: getUserHandler
  }),

  batchUsers: route.post('/users/batch', {
    body: UserBatchSchema,
    handle: getBatchUsersHandler
  })
})
