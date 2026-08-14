import { controller, route } from 'exisjs/router'
import { User } from '@/models/User'
import { JWT } from 'exisjs/auth'
import { BadRequestError, UnauthorizedError, InternalError } from 'exisjs/error'
import { tex } from 'exisjs/validator'
import { sanitize } from 'exisjs/sanitize'
import { cache } from 'exisjs/middleware'
import { protectRoute } from '@/middleware/auth'

const generateToken = (userId: string) => {
  return JWT.signJWT({ userId }, process.env.JWT_SECRET as string, {
    expiresIn: 15 * 24 * 60 * 60,
  }) // 15 days
}

export default controller({
  register: route.post('/register', {
    body: tex.object({
      email: tex.email({ trim: true, toLowerCase: true }),
      username: tex.string({ trim: true, toLowerCase: true, min: 3 }),
      password: tex.string({ min: 6 }),
    }),
    async handle({ body }) {
      const { email, username, password } = body

      // check if user already exists
      const existingEmail = await User.findOne({ email })
      if (existingEmail) {
        throw new BadRequestError('Email already exists')
      }

      const existingUsername = await User.findOne({ username })
      if (existingUsername) {
        throw new BadRequestError('Username already exists')
      }

      // get random avatar
      const profileImage = `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`

      const user = new User({
        email,
        username,
        password,
        profileImage,
      })

      await user.save()

      const token = generateToken((user._id as any).toString())

      return {
        token,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          profileImage: user.profileImage,
          createdAt: (user as any).createdAt,
        },
      }
    },
  }),

  login: route.post('/login', {
    body: tex.object({
      email: tex.email({ trim: true, toLowerCase: true }),
      password: tex.string(),
    }),
    async handle({ body }) {
      const { email, password } = body

      // check if user exists
      const user = await User.findOne({ email })
      if (!user) throw new UnauthorizedError('Invalid credentials')

      // check if password is correct
      const isPasswordCorrect = await (user as any).comparePassword(password)
      if (!isPasswordCorrect)
        throw new UnauthorizedError('Invalid credentials')

      const token = generateToken((user._id as any).toString())

      return {
        token,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          profileImage: user.profileImage,
          createdAt: (user as any).createdAt,
        },
      }
    },
  }),

  me: route.get('/me', {
    middleware: [protectRoute, cache({ ttlMs: 60000, keyGenerator: (req) => req.user?._id || 'anon' })],
    handle({ req }) {
      return {
        success: true,
        user: {
          id: req.user._id,
          username: req.user.username,
          email: req.user.email,
          profileImage: req.user.profileImage,
        },
      }
    },
  }),
})
