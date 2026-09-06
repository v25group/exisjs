import { Controller, Post, Get, Body, Use, Req } from 'exisjs/decorators'
import { User } from '@/models/User'
import { BadRequestError, UnauthorizedError } from 'exisjs/error'
import { tex } from 'exisjs/validator'
import jwt from 'jsonwebtoken'
import { protectRoute } from '@/middleware/auth'
import bcrypt from 'bcryptjs'

const generateToken = (userId: string) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET as string, {
    expiresIn: 15 * 24 * 60 * 60,
  }) // 15 days
}

const RegisterSchema = tex.object({
  email: tex.email({ trim: true, toLowerCase: true }),
  username: tex.string({ trim: true, toLowerCase: true, min: 3 }),
  password: tex.string({ min: 6 }),
})

const LoginSchema = tex.object({
  email: tex.email({ trim: true, toLowerCase: true }),
  password: tex.string(),
})

@Controller()
export default class AuthController {
  @Post('/register')
  async register(@Body(RegisterSchema) body: any) {
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

    const passwordHash = await bcrypt.hash(password, 10)

    const user = new User({
      email,
      username,
      password: passwordHash,
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
  }

  @Post('/login')
  async login(@Body(LoginSchema) body: any) {
    const { email, password } = body

    // check if user exists
    const user = await User.findOne({ email })
    if (!user) throw new UnauthorizedError('Invalid credentials')

    // check if password is correct
    const isPasswordCorrect = await (user as any).comparePassword(password)
    if (!isPasswordCorrect) throw new UnauthorizedError('Invalid credentials')

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
  }

  @Get('/me')
  @Use(protectRoute)
  async me(@Req() req: any) {
    return {
      success: true,
      user: {
        id: req.user._id,
        username: req.user.username,
        email: req.user.email,
        profileImage: req.user.profileImage,
      },
    }
  }
}
