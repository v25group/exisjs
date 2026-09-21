import type { Request, Response, NextFunction, Handler } from '../types'

export interface GuardOptions {
  statusCode?: number
  message?: string
}

/**
 * Creates a Guard middleware.
 * Guards evaluate a condition and return true to allow the request or false to block it.
 */
export function guard<TContext = Record<string, any>>(
  canActivate: (
    req: Request<any, any, any, TContext>
  ) => boolean | Promise<boolean>,
  options?: GuardOptions
): Handler<any, any, any, any, TContext> {
  return async (
    req: Request<any, any, any, TContext>,
    res: Response,
    next: NextFunction
  ) => {
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
