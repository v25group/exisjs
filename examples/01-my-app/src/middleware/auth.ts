import jwt from 'jsonwebtoken'
import { defineMiddleware } from 'exisjs/router'
import { UnauthorizedError } from 'exisjs/error'
import { env } from '@/config/env'

export interface AuthContext {
  user: { id: number; email: string }
}

export function signToken(user: AuthContext['user']): string {
  return jwt.sign(user, env.JWT_SECRET, { expiresIn: '1h' })
}

/**
 * Requires a valid "Authorization: Bearer <token>" header and sets req.user.
 * Routes that list it in `middleware` get a typed `req.user`.
 */
export const requireAuth = defineMiddleware<AuthContext>((req, _res, next) => {
  const header = req.header('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) {
    next(new UnauthorizedError('Missing bearer token'))
    return
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthContext['user']
    req.user = { id: payload.id, email: payload.email }
    next()
  } catch {
    next(new UnauthorizedError('Invalid or expired token'))
  }
})
