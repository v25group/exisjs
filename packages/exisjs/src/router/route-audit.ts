import * as fs from 'node:fs'
import * as path from 'node:path'

/** The reviewed list of routes open to anyone or to any signed-in user. */
export const ROUTE_AUDIT_FILE = 'routes-audit.json'

export interface RouteAuditEntry {
  method: string
  path: string
  /** `public`, `roles: a|b`, `perms: x+y`, or `-` when the route declares none */
  access?: string
}

export interface RouteAuditResult {
  /** Open routes nobody has reviewed: `GET /users` */
  unreviewed: string[]
  /** Reviewed entries that no longer match a route */
  stale: string[]
}

/** `GET /users/:id`, without the trailing slash a route file's `/` leaves */
export function routeAuditKey(route: RouteAuditEntry): string {
  const routePath = route.path.length > 1 ? route.path.replace(/\/$/, '') : '/'
  return `${route.method.toUpperCase()} ${routePath}`
}

/**
 * Compares the routing table with the reviewed list. A route with roles or
 * permissions is closed; `public`, or no rule at all, has to be on the list,
 * because no rule means any signed-in user or, without a default policy,
 * anyone.
 */
export function auditRouteTable(
  routes: RouteAuditEntry[],
  open: string[]
): RouteAuditResult {
  const reviewed = new Set(open)
  const keys = new Set(routes.map(routeAuditKey))
  const unreviewed = routes
    .filter((r) => r.access === 'public' || (r.access ?? '-') === '-')
    .map(routeAuditKey)
    .filter((key) => !reviewed.has(key))

  return {
    unreviewed: [...new Set(unreviewed)].sort(),
    stale: open.filter((key) => !keys.has(key)).sort(),
  }
}

/** Reads `routes-audit.json`; a project without one has reviewed nothing yet. */
export function loadRouteAudit(cwd: string = process.cwd()): string[] {
  const file = path.join(cwd, ROUTE_AUDIT_FILE)
  if (!fs.existsSync(file)) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    throw Object.assign(
      new Error(
        `[ExisJS] ${ROUTE_AUDIT_FILE} is not valid JSON: ${(err as Error).message}`
      ),
      { cause: err }
    )
  }

  const open = (parsed as { open?: unknown } | null)?.open
  if (!Array.isArray(open) || open.some((key) => typeof key !== 'string')) {
    throw new Error(
      `[ExisJS] ${ROUTE_AUDIT_FILE} must look like { "open": ["GET /health"] }`
    )
  }
  return open
}
