import { controller, route } from 'exisjs/router'
import { User } from '@/models/User'
import { JWT } from 'exisjs/auth'
import { BadRequestError, UnauthorizedError, InternalError } from 'exisjs/error'
import { v } from 'exisjs/validator'
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
    body: v.object({
      email: v.string().sanitize(sanitize.trim, sanitize.toLowerCase).email(),
      username: v.string().sanitize(sanitize.trim, sanitize.toLowerCase).min(3),
      password: v.string().min(6),
    }),
    async handle({ body }) {
      try {
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
      } catch (error) {
        if (error instanceof BadRequestError) throw error
        console.log('Error in register route', error)
        throw new InternalError('Internal server error')
      }
    },
  }),

  login: route.post('/login', {
    body: v.object({
      email: v.string().sanitize(sanitize.trim, sanitize.toLowerCase).email(),
      password: v.string(),
    }),
    async handle({ body }) {
      try {
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
      } catch (error) {
        if (error instanceof UnauthorizedError) throw error
        console.log('Error in login route', error)
        throw new InternalError('Internal server error')
      }
    },
  }),

  me: route.get('/me', {
    middleware: [protectRoute, cache({ ttlMs: 60000 })],
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
