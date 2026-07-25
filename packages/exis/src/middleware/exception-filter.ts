import type { ErrorHandler, Request, Response, NextFunction } from '../types'

export type AnyErrorClass = new (...args: any[]) => Error

/**
 * Creates an Exception Filter middleware that only catches and handles
 * errors of a specific class (e.g. HttpError, PrismaClientKnownRequestError).
 * If the error is not an instance of the class, it falls through to the next error handler.
 */
export function catchError<T extends Error>(
  errorClass: new (...args: any[]) => T,
  handler: (
    err: T,
    req: Request,
    res: Response,
    next: NextFunction
  ) => void | Promise<void>
): ErrorHandler {
  return function (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    if (err instanceof errorClass) {
      try {
        const result = handler(err as T, req, res, next)
        if (result instanceof Promise) {
          result.catch(next)
        }
      } catch (handlerErr) {
        next(handlerErr as Error)
      }
      return
    }
    next(err)
  }
}
