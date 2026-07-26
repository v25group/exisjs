import fs from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'

export async function generateDependencyGraph(
  apiDir: string,
  cwd: string
): Promise<Map<string, Set<string>>> {
  const graph = new Map<string, Set<string>>()
  const visited = new Set<string>()

  const routeFiles = await findRouteFiles(apiDir)

  for (const routeFile of routeFiles) {
    await processFile(routeFile, routeFile, cwd, graph, visited)
  }

  // Also save to .exis/dev/dependency-graph.json (skip during tests)
  if (process.env.NODE_ENV !== 'test' && process.env.__EXIS_TEST !== 'true') {
    const exisDevPath = path.join(cwd, '.exis', 'dev')
    try {
      await fs.mkdir(exisDevPath, { recursive: true })
      const serializable: Record<string, string[]> = {}
      for (const [dep, routes] of graph.entries()) {
        serializable[path.relative(cwd, dep)] = Array.from(routes).map((r) =>
          path.relative(cwd, r)
        )
      }
      await fs.writeFile(
        path.join(exisDevPath, 'dependency-graph.json'),
        JSON.stringify(serializable, null, 2)
      )
    } catch {
      // Ignore errors saving
    }
  }

  return graph
}

async function findRouteFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await findRouteFiles(fullPath)))
    } else if (entry.name === 'route.ts' || entry.name === 'route.js') {
      files.push(fullPath)
    }
  }
  return files
}

async function processFile(
  filePath: string,
  routeFilePath: string,
  cwd: string,
  graph: Map<string, Set<string>>,
  visited: Set<string>
) {
  const visitKey = `${filePath}:${routeFilePath}`
  if (visited.has(visitKey)) return
  visited.add(visitKey)

  let content: string
  try {
    content = await fs.readFile(filePath, 'utf8')
  } catch {
    return
  }

  const importRegex =
    /(?:import|export)(?:\s+(?:[^'"]*)\s+from\s+)?['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)/g
  let match
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1] || match[2]
    if (!importPath) continue

    if (importPath.startsWith('.')) {
      const resolved = resolveImport(filePath, importPath)
      if (resolved) {
        addEdge(resolved, routeFilePath, graph)
        await processFile(resolved, routeFilePath, cwd, graph, visited)
      }
    } else if (importPath.startsWith('@/')) {
      const resolved = resolveAlias(cwd, importPath)
      if (resolved) {
        addEdge(resolved, routeFilePath, graph)
        await processFile(resolved, routeFilePath, cwd, graph, visited)
      }
    }
  }
}

function addEdge(
  dependency: string,
  dependent: string,
  graph: Map<string, Set<string>>
) {
  const dep = path.resolve(dependency)
  const dest = path.resolve(dependent)
  if (!graph.has(dep)) graph.set(dep, new Set())
  graph.get(dep)!.add(dest)
}

function resolveImport(
  importerFile: string,
  importPath: string
): string | null {
  const dir = path.dirname(importerFile)
  const target = path.join(dir, importPath)
  return resolveFile(target)
}

function resolveAlias(cwd: string, importPath: string): string | null {
  const target = path.join(cwd, 'src', importPath.slice(2))
  return resolveFile(target)
}

function resolveFile(basePath: string): string | null {
  if (basePath.endsWith('.ts') || basePath.endsWith('.js')) {
    if (existsSync(basePath)) return basePath
  }
  const extensions = ['.ts', '.js', '/index.ts', '/index.js']
  for (const ext of extensions) {
    const fullPath = basePath + ext
    if (existsSync(fullPath)) return fullPath
  }
  return null
}
