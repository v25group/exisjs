import { HttpError } from '../error/errors'

/** Access rule of one route, from `@Roles` / `@Permissions` / `@Public` or functional `roles` / `permissions` / `public`. */
export interface AccessRule {
  isPublic: boolean
  roles: string[]
  permissions: string[]
}

export interface AuthorizationConfig {
  /**
   * Returns true for a user who may access every route regardless of roles
   * and permissions. Called only for an authenticated `req.user`.
   *
   * @example
   * ```ts
   * authorization: { superUser: (user) => user.role === 'owner' }
   * ```
   */
  superUser?: (user: any) => boolean
  /**
   * What a controller route that declares no rule allows.
   * - `'public'` (default): anyone.
   * - `'authenticated'`: deny by default; a signed-in `req.user` is required
   *   unless the route is `@Public()` / `public: true`. A route that forgot
   *   its decorator is then closed instead of open.
   *
   * Applies to class and functional controllers, not to plain `app.get()`
   * routes (health checks, docs).
   */
  defaultPolicy?: 'public' | 'authenticated'
}

/**
 * The signed-in user, or a 401 when there is none. Use it in handlers that
 * need a user, so the type is never `undefined` and no `!` is needed.
 *
 * @example
 * ```ts
 * handle({ req }) {
 *   const me = requireUser(req)
 *   return listOrders(me.id)
 * }
 * ```
 */
export function requireUser(req: {
  user?: unknown
}): import('./types').RequestUser {
  if (req.user === undefined || req.user === null) {
    throw new HttpError('Authentication required', 401, 'UNAUTHORIZED')
  }
  return req.user as import('./types').RequestUser
}

/** One-line description of a rule, e.g. `roles: admin|editor` */
export function describeAccess(rule: AccessRule | undefined): string {
  if (!rule) return '-'
  if (rule.isPublic) return 'public'
  const parts: string[] = []
  if (rule.roles.length > 0) parts.push(`roles: ${rule.roles.join('|')}`)
  if (rule.permissions.length > 0) {
    parts.push(`perms: ${rule.permissions.join('+')}`)
  }
  return parts.length > 0 ? parts.join('; ') : '-'
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value
  return typeof value === 'string' ? [value] : []
}

export function toAccessList(value: unknown): string[] {
  return value === undefined || value === null ? [] : toList(value)
}

/**
 * Throws 401 when the route requires roles or permissions and there is no
 * `req.user`, and 403 when the user lacks them.
 *
 * - `@Public()` wins over `@Roles` / `@Permissions`.
 * - Roles: the user needs **one** of the listed roles (`user.roles` or `user.role`).
 * - Permissions: the user needs **all** listed permissions (`user.permissions`).
 *   A role is never treated as a permission.
 */
export function checkAccess(
  user: any,
  rule: AccessRule,
  config?: AuthorizationConfig
): void {
  if (rule.isPublic) return
  if (rule.roles.length === 0 && rule.permissions.length === 0) {
    if (
      config?.defaultPolicy === 'authenticated' &&
      (user === undefined || user === null)
    ) {
      throw new HttpError('Authentication required', 401, 'UNAUTHORIZED')
    }
    return
  }

  if (user === undefined || user === null) {
    throw new HttpError('Authentication required', 401, 'UNAUTHORIZED')
  }
  if (config?.superUser?.(user) === true) return

  if (rule.roles.length > 0) {
    const userRoles = toList(user.roles ?? user.role)
    if (!rule.roles.some((r) => userRoles.includes(r))) {
      throw new HttpError(
        'Insufficient role to access this resource',
        403,
        'FORBIDDEN'
      )
    }
  }

  if (rule.permissions.length > 0) {
    const userPerms = toList(user.permissions)
    if (!rule.permissions.every((p) => userPerms.includes(p))) {
      throw new HttpError(
        'Insufficient permissions to access this resource',
        403,
        'FORBIDDEN'
      )
    }
  }
}
