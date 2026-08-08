import { HttpError } from '../utils/errors'
import type { Request, Response, NextFunction } from '../types'

/**
 * Middleware that ensures the authenticated user has one of the required roles.
 * Expects `req.user` to be populated (e.g., by a previous session or JWT middleware),
 * and expects `req.user.role` to be a string or array of strings.
 *
 * @param allowedRoles A single role string or an array of allowed roles.
 */
export function requireRole(allowedRoles: string | string[]) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles]

  return (req: Request, res: Response, next: NextFunction) => {
    // 1. Ensure user is authenticated
    if (!req.user) {
      return next(
        HttpError.unauthorized(
          'Authentication required to access this resource'
        )
      )
    }

    // 2. Ensure user has a role property
    if (!req.user.role) {
      return next(HttpError.forbidden('Access denied: No role assigned'))
    }

    const userRoles = Array.isArray(req.user.role)
      ? (req.user.role as string[])
      : [req.user.role as string]

    // 3. Check for intersection between user roles and allowed roles
    const hasRole = userRoles.some((role) => roles.includes(role))

    if (!hasRole) {
      return next(
        HttpError.forbidden('Access denied: Insufficient permissions')
      )
    }

    next()
  }
}
