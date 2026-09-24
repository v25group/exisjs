import {
  PERMISSIONS_METADATA,
  ROLES_METADATA,
  IS_PUBLIC_METADATA,
  ROUTE_METADATA_PROP,
} from './constants'
import { MetadataEngine } from './core/metadata'

/**
 * Declares required permission keys for a Controller class or route method.
 *
 * @example
 * ```ts
 * @Controller('/roles')
 * export class RolesController {
 *   @Post('/')
 *   @Permissions('role:create', 'role:manage')
 *   async createRole() {}
 * }
 * ```
 */
export function Permissions(...permissions: string[]): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    const isStandard =
      typeof contextOrPropertyKey === 'object' && contextOrPropertyKey !== null
    const kind = isStandard ? contextOrPropertyKey.kind : undefined

    if (
      kind === 'class' ||
      (!isStandard && typeof target === 'function' && !contextOrPropertyKey)
    ) {
      const proto = target.prototype || target
      MetadataEngine.set(proto, PERMISSIONS_METADATA, permissions)
    } else {
      const fn = isStandard
        ? target
        : descriptor
          ? descriptor.value
          : target[contextOrPropertyKey]
      MetadataEngine.set(fn, PERMISSIONS_METADATA, permissions)
      const routeMeta = MetadataEngine.init<any>(fn, ROUTE_METADATA_PROP, {})
      routeMeta.permissions = [...(routeMeta.permissions || []), ...permissions]
    }
  }
}

/**
 * Declares required roles for a Controller class or route method.
 *
 * @example
 * ```ts
 * @Controller('/admin')
 * @Roles('admin', 'superadmin')
 * export class AdminController {}
 * ```
 */
export function Roles(...roles: string[]): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    const isStandard =
      typeof contextOrPropertyKey === 'object' && contextOrPropertyKey !== null
    const kind = isStandard ? contextOrPropertyKey.kind : undefined

    if (
      kind === 'class' ||
      (!isStandard && typeof target === 'function' && !contextOrPropertyKey)
    ) {
      const proto = target.prototype || target
      MetadataEngine.set(proto, ROLES_METADATA, roles)
    } else {
      const fn = isStandard
        ? target
        : descriptor
          ? descriptor.value
          : target[contextOrPropertyKey]
      MetadataEngine.set(fn, ROLES_METADATA, roles)
      const routeMeta = MetadataEngine.init<any>(fn, ROUTE_METADATA_PROP, {})
      routeMeta.roles = [...(routeMeta.roles || []), ...roles]
    }
  }
}

/**
 * Marks a Controller class or route method as public, bypassing global authentication guards.
 *
 * @example
 * ```ts
 * @Controller('/auth')
 * export class AuthController {
 *   @Post('/login')
 *   @Public()
 *   async login() {}
 * }
 * ```
 */
export function Public(): any {
  return function (
    target: any,
    contextOrPropertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    const isStandard =
      typeof contextOrPropertyKey === 'object' && contextOrPropertyKey !== null
    const kind = isStandard ? contextOrPropertyKey.kind : undefined

    if (
      kind === 'class' ||
      (!isStandard && typeof target === 'function' && !contextOrPropertyKey)
    ) {
      const proto = target.prototype || target
      MetadataEngine.set(proto, IS_PUBLIC_METADATA, true)
    } else {
      const fn = isStandard
        ? target
        : descriptor
          ? descriptor.value
          : target[contextOrPropertyKey]
      MetadataEngine.set(fn, IS_PUBLIC_METADATA, true)
      const routeMeta = MetadataEngine.init<any>(fn, ROUTE_METADATA_PROP, {})
      routeMeta.isPublic = true
    }
  }
}

export const IsPublic = Public
export const AllowAnonymous = Public
