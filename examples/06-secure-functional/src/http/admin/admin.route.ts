import { controller, route } from 'exisjs/router'
import { users } from '@/database/db'

export default controller({
  users: route.get('/users', {
    roles: ['admin'],
    async handle() {
      const all = await users.find({}, { projection: { passwordHash: 0 } }).toArray()
      return all.map((u) => ({ email: u.email, role: u.role }))
    },
  }),

  secret: route.get('/secret', {
    // No route rule: only the boundary protects this one
    public: true,
    handle: () => ({ secret: 'ADMIN_ONLY_SECRET' }),
  }),
})
