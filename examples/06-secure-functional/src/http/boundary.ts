import { csrf } from 'exisjs/middleware'
import type { Next, Request, Response } from 'exisjs/router'
import { loadUser } from '@/common/session'
import { SESSION_COOKIE } from '@/common/session-cookie'
import { env } from '@/config/env'

export const protectFromCsrf = csrf({
  secret: env.CSRF_SECRET,
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production' && !process.env.INSECURE_COOKIES,
  },
})

export async function loadSession(req: Request, _res: Response, next: Next) {
  const token = req.cookies[SESSION_COOKIE]
  if (token) (req as any).user = await loadUser(token)
  next()
}
