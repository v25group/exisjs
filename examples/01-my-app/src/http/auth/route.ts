import { controller, route, after } from 'exisjs/router'
import { v } from 'exisjs/validator'
import { enqueue } from 'exisjs/queue'
import { JWT, Password } from 'exisjs/auth'
import { UnauthorizedError, BadRequestError } from 'exisjs/error'

// Simple in-memory database to store registered users
interface User {
  id: number
  name: string
  email: string
  passwordHash: string
}

const usersDatabase: User[] = []
let nextUserId = 1

export default controller({
  login: route.post('/login', {
    body: v.object({
      email: v.string().email(),
      password: v.string().min(6),
    }),
    async handle({ body, req, app }) {
      after(() => {
        app.log.info(
          { email: body.email },
          'User logged in (deferred logging)'
        )
      })

      // 1. Look up user by email
      const user = usersDatabase.find((u) => u.email === body.email)
      if (!user) {
        throw new UnauthorizedError('Invalid email or password')
      }

      // 2. Verify scrypt password hash
      const isPasswordCorrect = await Password.verifyPassword(
        body.password,
        user.passwordHash
      )
      if (!isPasswordCorrect) {
        throw new UnauthorizedError('Invalid email or password')
      }

      // 3. Sign JWT natively
      const token = JWT.signJWT(
        { id: user.id, role: 'user' },
        process.env.JWT_SECRET || 'my-super-secret-jwt-key'
      )

      return { success: true, token }
    },
  }),

  register: route.post('/register', {
    body: v.object({
      name: v.string().min(2),
      email: v.string().email(),
      password: v.string().min(6),
    }),
    async handle({ body, app }) {
      console.log('--- Incoming body in /auth/register ---', body)
      // 1. Check if user already exists
      const exists = usersDatabase.some((u) => u.email === body.email)
      if (exists) {
        throw new BadRequestError('Email is already registered')
      }

      // 2. Hash password with Scrypt natively
      const passwordHash = await Password.hashPassword(body.password)

      // 3. Save user to in-memory store
      const userId = nextUserId++
      usersDatabase.push({
        id: userId,
        name: body.name,
        email: body.email,
        passwordHash,
      })

      // 4. Dispatch background job
      await enqueue('welcome-email', {
        email: body.email,
        name: body.name,
      })

      // 5. Sign JWT natively
      const token = JWT.signJWT(
        { id: userId, role: 'user' },
        process.env.JWT_SECRET || 'my-super-secret-jwt-key'
      )

      return { success: true, userId, token }
    },
  }),
})
