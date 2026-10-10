import bcrypt from 'bcryptjs'
import { controller, route } from 'exisjs/router'
import { tex } from 'exisjs/validator'
import { ConflictError, UnauthorizedError } from 'exisjs/error'
import { signToken } from '@/middleware/auth'
import { UsersService } from '../users/service'

const RegisterSchema = tex.object({
  name: tex.string({ min: 2, max: 60, trim: true }),
  email: tex.email({ trim: true, toLowerCase: true }),
  password: tex.string({ min: 8, max: 72 }),
})

const LoginSchema = tex.object({
  email: tex.email({ trim: true, toLowerCase: true }),
  password: tex.string(),
})

export default controller({
  register: route.post('/register', {
    summary: 'Create an account',
    body: RegisterSchema,
    httpCode: 201,
    async handle({ body, resolve }) {
      const users = resolve(UsersService)
      if (users.findByEmail(body.email)) {
        throw new ConflictError('Email is already registered')
      }

      const passwordHash = await bcrypt.hash(body.password, 10)
      const user = users.create({
        name: body.name,
        email: body.email,
        passwordHash,
      })

      return { user, token: signToken({ id: user.id, email: user.email }) }
    },
  }),

  login: route.post('/login', {
    summary: 'Exchange credentials for a token',
    body: LoginSchema,
    async handle({ body, resolve }) {
      const user = resolve(UsersService).findByEmail(body.email)
      // Same error for an unknown email and a wrong password, so the response
      // does not reveal which accounts exist
      if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
        throw new UnauthorizedError('Invalid email or password')
      }
      return { token: signToken({ id: user.id, email: user.email }) }
    },
  }),
})
