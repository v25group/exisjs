import type { Request, Response, NextFunction } from '../types'

export interface GuardOptions {
  statusCode?: number
  message?: string
}

/**
 * Creates a Guard middleware.
 * Guards evaluate a condition and return true to allow the request or false to block it.
 */
export function guard(
  canActivate: (req: Request) => boolean | Promise<boolean>,
  options?: GuardOptions
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const isAllowed = await canActivate(req)
      if (isAllowed) {
        next()
      } else {
        res.status(options?.statusCode || 403).json({
          error: options?.message || 'Forbidden',
        })
      }
    } catch (err) {
      next(err as Error)
    }
  }
}
