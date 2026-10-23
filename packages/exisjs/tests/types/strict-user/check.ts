// Compile-only (npm run typecheck): a declared ExisUser is exact, and with
// strict: true req.user may be undefined until checked
import type { Request } from '../../../src/types'
import { requireUser } from '../../../src/router/authorize'

declare module '../../../src/router/types' {
  interface ExisUser {
    id: string
    permissions: string[]
  }
  interface ExisTypeOptions {
    strict: true
  }
}

export function handler(req: Request) {
  // @ts-expect-error undefined on public routes and before authentication
  const unchecked = req.user.id

  const me = requireUser(req)
  const id: string = me.id

  // @ts-expect-error a field the app never declared (the removed userId)
  const removed = me.userId

  // @ts-expect-error a request property nobody declared
  const tenant = req.organisationId

  if (req.user) {
    const perms: string[] = req.user.permissions
    return { perms }
  }
  return { unchecked, id, removed, tenant }
}
