import { controller, route, after } from 'exisjs/router'
import { tex } from 'exisjs/validator'
import { UnauthorizedError, BadRequestError } from 'exisjs/error'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

// Simple in-memory database to store registered users
interface User {
  id: number
  name?: string
  email: string
  passwordHash: string
}

const usersDatabase: User[] = []
let nextUserId = 1

export default controller({
  login: route.post('/login', {
    body: tex.object({
      email: tex.email(),
      password: tex.string({ min: 6 }),
    }),
    async handle({ body, req, app }) {
      after(() => {
        app.log.info({ email: body.email }, 'User logged in (deferred logging)')
      })

      // 1. Look up user by email
      const user = usersDatabase.find((u) => u.email === body.email)
      if (!user) {
        throw new UnauthorizedError('Invalid email or password')
      }

      // 2. Verify scrypt password hash
      const isPasswordCorrect = await bcrypt.compare(
        body.password,
        user.passwordHash
      )
      if (!isPasswordCorrect) {
        throw new UnauthorizedError('Invalid email or password')
      }

      // 3. Sign JWT natively
      const token = jwt.sign(
        { id: user.id, role: 'user' },
        process.env.JWT_SECRET || 'my-super-secret-jwt-key'
      )

      return { success: true, token }
    },
  }),

  register: route.post('/register', {
    body: tex.object({
      name: tex.string({ min: 2 }),
      email: tex.email(),
      password: tex.string({ min: 6 }),
    }),
    async handle({ body, app }) {
      console.log('--- Incoming body in /auth/register ---', body)
      // 1. Check if user already exists
      const exists = usersDatabase.some((u) => u.email === body.email)
      if (exists) {
        throw new BadRequestError('Email is already registered')
      }

      // 2. Hash password with Scrypt natively
      const passwordHash = await bcrypt.hash(body.password, 10)

      // 3. Save user to in-memory store
      const userId = nextUserId++
      usersDatabase.push({
        id: userId,
        name: body.name,
        email: body.email,
        passwordHash,
      })

      // 5. Sign JWT natively
      const token = jwt.sign(
        { id: userId, role: 'user' },
        process.env.JWT_SECRET || 'my-super-secret-jwt-key'
      )

      return { success: true, userId, token }
    },
  }),
})
