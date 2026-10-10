import jwt from 'jsonwebtoken'
import { UnauthorizedError } from 'exisjs/error'
import type { NextFunction, Request, Response } from 'exisjs/router'
import { env } from '@/config/env'
import { User, type UserDocument } from '@/models/User'

/** A request that passed `protectRoute` */
export type AuthedRequest = Request & { user: UserDocument }

export function signToken(userId: string): string {
  return jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: '15d' })
}

/**
 * Requires "Authorization: Bearer <token>" and loads the user into req.user.
 * Errors go to next(), so the client gets the framework's standard error
 * response instead of a hand-written one.
 */
export const protectRoute = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const header = req.header('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) {
    next(new UnauthorizedError('Missing bearer token'))
    return
  }

  try {
    const { userId } = jwt.verify(token, env.JWT_SECRET) as { userId: string }
    const user = await User.findById(userId)
    if (!user) {
      next(new UnauthorizedError('Invalid or expired token'))
      return
    }
    ;(req as AuthedRequest).user = user
    next()
  } catch {
    next(new UnauthorizedError('Invalid or expired token'))
  }
}
