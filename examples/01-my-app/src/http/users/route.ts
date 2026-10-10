import { controller, route } from 'exisjs/router'
import { NotFoundError } from 'exisjs/error'
import { requireAuth } from '@/middleware/auth'
import { UserParamsSchema } from './schema'
import { UsersService } from './service'

export default controller({
  list: route.get('/', {
    summary: 'List users',
    handle({ resolve }) {
      return resolve(UsersService).findAll()
    },
  }),

  me: route.get('/me', {
    summary: 'The authenticated user',
    // Listing the middleware here types req.user; the boundary already ran it
    middleware: [requireAuth],
    handle({ req, resolve }) {
      const user = resolve(UsersService).findById(req.user.id)
      if (!user) throw new NotFoundError('User')
      return user
    },
  }),

  getById: route.get('/:id', {
    summary: 'Get a user by id',
    params: UserParamsSchema,
    handle({ params, resolve }) {
      // params.id is a number here: validation runs before the handler
      const user = resolve(UsersService).findById(params.id)
      if (!user) throw new NotFoundError('User')
      return user
    },
  }),
})
