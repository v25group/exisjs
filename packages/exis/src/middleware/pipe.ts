import type { Request, Response, NextFunction } from '../types'

type PayloadLocation = 'body' | 'query' | 'params'

/**
 * Creates a Pipe middleware.
 * Pipes transform or validate input data before it reaches the route handler.
 */
export function pipe(
  location: PayloadLocation,
  key: string,
  transformFn: (val: any) => any
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const target = req[location] as Record<string, any> | undefined
      if (target && target[key] !== undefined) {
        target[key] = await transformFn(target[key])
      }
      next()
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Validation failed',
      })
    }
  }
}
