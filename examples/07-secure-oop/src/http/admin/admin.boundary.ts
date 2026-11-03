import { HttpError } from 'exisjs/error'
import type { Next, Request, Response } from 'exisjs/router'

// Folder-level auth: the kind NestJS and Fastify apps lost to a trailing slash
export function requireAdmin(req: Request, _res: Response, next: Next) {
  const roles = (req as any).user?.roles ?? []
  if (!roles.includes('admin')) throw HttpError.forbidden('Admins only')
  next()
}
