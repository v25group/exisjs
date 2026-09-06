import { controller, route } from 'exisjs/router'
import { UserParamsSchema, UserBatchSchema } from './schema'
import { fetchUser, fetchBatchUsers } from './service'

export default controller({
  getUsers: route.get('/users/:id', {
    params: UserParamsSchema,
    async handle({ params }) {
      const user = await fetchUser(params.id)
      return { source: 'functional', user }
    },
  }),

  batchUsers: route.post('/users/batch', {
    body: UserBatchSchema,
    async handle({ body }) {
      const users = await fetchBatchUsers(body.ids)
      return { source: 'functional', users }
    },
  }),
})
