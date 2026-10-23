// Compile-only (npm run typecheck): an app that never declares ExisUser keeps
// working as before: any field on req.user, always present
import type { Request } from '../../../src/types'

export function handler(req: Request) {
  const id: string = req.user.id
  const roles: string[] = req.user.anything
  return { id, roles, custom: req.organisationId }
}
