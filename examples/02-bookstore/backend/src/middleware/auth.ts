import { JWT } from 'exisjs/auth'
import { User } from '@/models/User'
import { HttpError } from 'exisjs/error'
import type { NextFunction, Request, Response } from 'exisjs/router'

export const protectRoute = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers['authorization']
    if (!authHeader) {
      throw HttpError.unauthorized('No authentication token, access denied')
    }

    const token = authHeader.replace('Bearer ', '')
    if (!token) {
      throw HttpError.unauthorized('No authentication token, access denied')
    }

    // verify token using native ExisJS JWT integration
    const decoded = JWT.verifyJWT<{ userId: string }>(
      token,
      process.env.JWT_SECRET as string
    )

    // find user
    const user = await User.findById(decoded.userId).select('-password')
    if (!user) {
      throw HttpError.unauthorized('Token is not valid')
    }

    req.user = user
    next()
  } catch (error: any) {
    console.error('Authentication error:', error.message)
    res.status(401).json({ message: 'Token is not valid' })
  }
}
