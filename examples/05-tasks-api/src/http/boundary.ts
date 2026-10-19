import { defineBoundary } from 'exisjs/router'
import type { Request, Response, Next, BoundaryContext } from 'exisjs/router'

export const config = defineBoundary({
  // Response headers for every route below this folder
  headers: {},
})

// Named middleware running in declaration order before child routes
export function logRequest(req: Request, res: Response, next: Next) {
  next()
}

// Wrapper around all requests in this boundary
export default async function (ctx: BoundaryContext, next: Next) {
  return next()
}
