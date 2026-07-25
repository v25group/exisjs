import type { Handler, Request, Response, NextFunction } from '../types'

export type TransformFunction = (
  data: any,
  req: Request,
  res: Response
) => any | Promise<any>

export function intercept(transform: TransformFunction): Handler {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res)
    let intercepted = false

    res.json = function (data: any) {
      if (intercepted) return originalJson(data)
      intercepted = true

      try {
        const transformed = transform(data, req, res)
        if (transformed instanceof Promise) {
          transformed
            .then((newData) =>
              originalJson(newData !== undefined ? newData : data)
            )
            .catch(next)
        } else {
          originalJson(transformed !== undefined ? transformed : data)
        }
      } catch (err) {
        next(err as Error)
      }
      return res as any
    }

    // Only intercept res.json! res.send is for raw strings/buffers and shouldn't be wrapped.

    next()
  }
}
