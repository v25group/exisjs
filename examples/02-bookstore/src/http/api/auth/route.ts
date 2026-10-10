import {
  Controller,
  Post,
  Get,
  Body,
  Use,
  Req,
  HttpCode,
} from 'exisjs/decorators'
import { ConflictError, UnauthorizedError } from 'exisjs/error'
import { tex } from 'exisjs/validator'
import type { Infer } from 'exisjs/validator'
import { User, type UserDocument } from '@/models/User'
import {
  protectRoute,
  signToken,
  type AuthedRequest,
} from '@/middleware/auth'

const RegisterSchema = tex.object({
  email: tex.email({ trim: true, toLowerCase: true }),
  username: tex.string({ trim: true, toLowerCase: true, min: 3, max: 30 }),
  password: tex.string({ min: 8, max: 72 }),
})

const LoginSchema = tex.object({
  email: tex.email({ trim: true, toLowerCase: true }),
  password: tex.string(),
})

// Infer the handler argument types from the schemas instead of using `any`
type RegisterDto = Infer<typeof RegisterSchema>
type LoginDto = Infer<typeof LoginSchema>

function toPublicUser(user: UserDocument) {
  return {
    id: user.id as string,
    username: user.username,
    email: user.email,
    profileImage: user.profileImage,
    createdAt: user.createdAt,
  }
}

@Controller()
export default class AuthController {
  @Post('/register')
  @HttpCode(201)
  async register(@Body(RegisterSchema) body: RegisterDto) {
    const taken = await User.findOne({
      $or: [{ email: body.email }, { username: body.username }],
    })
    if (taken) {
      throw new ConflictError(
        taken.email === body.email
          ? 'Email is already registered'
          : 'Username is already taken'
      )
    }

    // The model hashes the password in its pre-save hook
    const user = await User.create({
      ...body,
      profileImage: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(body.username)}`,
    })

    return { token: signToken(user.id), user: toPublicUser(user) }
  }

  @Post('/login')
  async login(@Body(LoginSchema) body: LoginDto) {
    // password is excluded from queries by default; ask for it explicitly
    const user = await User.findOne({ email: body.email }).select('+password')
    // Same error for an unknown email and a wrong password, so the response
    // does not reveal which accounts exist
    if (!user || !(await user.comparePassword(body.password))) {
      throw new UnauthorizedError('Invalid email or password')
    }
    return { token: signToken(user.id), user: toPublicUser(user) }
  }

  @Get('/me')
  @Use(protectRoute)
  me(@Req() req: AuthedRequest) {
    return { user: toPublicUser(req.user) }
  }
}
