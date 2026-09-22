import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export interface ScannedRoute {
  filePath: string
  routePath: string
}

/**
 * Recursively scans a directory and computes the route path for each file.
 * Handles:
 * - `(group)` route groups (skipped from URL path)
 * - `[...param]` wildcard parameters (transformed to `*param`)
 * - `[param]` dynamic route parameters (transformed to `:param`)
 */
export async function scanDirectory(
  dir: string,
  baseRoute = '/'
): Promise<ScannedRoute[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const results: ScannedRoute[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      let segment = entry.name

      // Route groups: (group) -> do not add segment to URL
      if (segment.startsWith('(') && segment.endsWith(')')) {
        const subResults = await scanDirectory(fullPath, baseRoute)
        results.push(...subResults)
        continue
      }

      // Wildcard / Catch-all params: [...slug] -> *slug
      if (segment.startsWith('[...') && segment.endsWith(']')) {
        segment = '*' + segment.slice(4, -1)
      } else {
        // Dynamic route params: [id] -> :id
        segment = segment.replace(/\[(.*?)\]/g, ':$1')
      }

      const nextBase =
        baseRoute === '/' ? `/${segment}` : `${baseRoute}/${segment}`
      const subResults = await scanDirectory(fullPath, nextBase)
      results.push(...subResults)
    } else {
      results.push({ filePath: fullPath, routePath: baseRoute })
    }
  }
  return results
}

/**
 * Recursively retrieves all files within a directory matching script extensions.
 */
export async function getFilesRecursively(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await getFilesRecursively(full)))
    } else if (
      entry.isFile() &&
      /\.[jmt]s$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(full)
    }
  }
  return files
}

/**
 * Determines whether a file path represents a boundary definition.
 */
export function isBoundaryFile(filePath: string): boolean {
  return (
    filePath.endsWith('boundary.ts') ||
    filePath.endsWith('boundary.js') ||
    /\.boundary\.[jt]s$/.test(filePath)
  )
}

/**
 * Determines whether a file path represents a route definition.
 */
export function isRouteFile(filePath: string): boolean {
  return (
    filePath.endsWith('route.ts') ||
    filePath.endsWith('route.js') ||
    /\.route\.[jt]s$/.test(filePath)
  )
}
