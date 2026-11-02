import * as path from 'node:path'
import type { Route } from '../types'
import { isBoundaryFile, isRouteFile } from './fs-scanner'

export const ROUTE_CONFLICT = 'ROUTE_CONFLICT'

/** A routing table that cannot be served as written; always stops the start. */
export class RouteConflictError extends Error {
  readonly code = ROUTE_CONFLICT

  constructor(message: string) {
    super(`[ExisJS] ${message}`)
    this.name = 'RouteConflictError'
  }
}

const relative = (file: string) =>
  path.relative(process.cwd(), file).replace(/\\/g, '/')

/** Throws when a folder holds more than one of the files `matches` accepts. */
function assertOnePerFolder(
  files: string[],
  matches: (file: string) => boolean,
  kind: string,
  fix: string
): void {
  const byFolder = new Map<string, string[]>()
  for (const file of files) {
    if (!matches(file)) continue
    const folder = path.dirname(file)
    const inFolder = byFolder.get(folder)
    if (inFolder) inFolder.push(file)
    else byFolder.set(folder, [file])
  }

  const clashes = [...byFolder.values()].filter((f) => f.length > 1)
  if (clashes.length === 0) return

  const described = clashes.map((inFolder) =>
    inFolder
      .sort()
      .map((f) => `    → ${relative(f)}`)
      .join('\n')
  )
  throw new RouteConflictError(
    `A folder can only hold one ${kind} file.\n\n` +
      `${described.join('\n\n')}\n\n` +
      `Fix: ${fix}`
  )
}

export function assertOneRouteFilePerFolder(files: string[]): void {
  assertOnePerFolder(
    files,
    isRouteFile,
    'route',
    'Delete the leftover file, or move the second resource to a sub-folder.'
  )
}

export function assertOneBoundaryFilePerFolder(files: string[]): void {
  assertOnePerFolder(
    files,
    isBoundaryFile,
    'boundary',
    'Merge them into one file; a boundary applies to its whole folder.'
  )
}

// Param names don't take part: the router matches /users/:id and /users/:slug
// at the same position, so one of the two would never answer
function routeKey(route: Route): string {
  const segments = route.path
    .split('/')
    .filter(Boolean)
    .map((s) => (s[0] === ':' ? ':' : s[0] === '*' ? '*' : s))
  return `${route.method} ${String(route.host ?? '')} /${segments.join('/')}`
}

/**
 * Throws when two routes answer the same method and path, because which one
 * wins would depend on load order. Routes registered only in code are left
 * out unless a route file collides with them.
 *
 * @param onlyFile report only the collisions involving this file
 */
export function assertNoRouteConflicts(
  routes: Route[],
  onlyFile?: string
): void {
  const seen = new Map<string, Route[]>()
  for (const route of routes) {
    // A dev placeholder stands in for a file that has not loaded yet
    if (route.sourceFile?.startsWith('lazy:')) continue
    const key = routeKey(route)
    const same = seen.get(key)
    if (same) same.push(route)
    else seen.set(key, [route])
  }

  const conflicts = [...seen.values()].filter(
    (same) =>
      same.length > 1 &&
      same.some((r) => r.sourceFile) &&
      (!onlyFile || same.some((r) => r.sourceFile === onlyFile))
  )
  if (conflicts.length === 0) return

  const described = conflicts.map((same) => {
    const sources = same.map((r) =>
      r.sourceFile
        ? `    → ${relative(r.sourceFile)} (${r.path})`
        : `    → registered in code (${r.path})`
    )
    return `  ${same[0].method} ${same[0].path}\n${sources.join('\n')}`
  })

  throw new RouteConflictError(
    `The same method and path is registered more than once.\n\n` +
      `${described.join('\n\n')}\n\n` +
      `Fix: Keep one of them, or give each its own path.`
  )
}
