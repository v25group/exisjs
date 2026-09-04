import path from 'node:path'
import type { Router } from '../router/router'
import { formatDevError } from '../dev/error-overlay'
import { generateDependencyGraph } from '../dev/dep-graph'

const c = {
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
}

function ts(): string {
  const now = new Date()
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `${c.gray}[${h}:${m}:${s}]${c.reset}`
}

interface HotReloaderOptions {
  apiDirs: string[]
  router: Router
  routeMap: Map<string, string>
  mountRoute: (filePath: string, routePath: string) => Promise<void>
  clearCache: () => void
}

export class HotReloader {
  private apiDirs: string[]
  private router: Router
  private routeMap: Map<string, string>
  private mountRoute: (filePath: string, routePath: string) => Promise<void>
  private clearCache: () => void
  private watcher: import('chokidar').FSWatcher | null = null
  private depGraph = new Map<string, Set<string>>()

  constructor(opts: HotReloaderOptions) {
    this.apiDirs = opts.apiDirs
    this.router = opts.router
    this.routeMap = opts.routeMap
    this.mountRoute = opts.mountRoute
    this.clearCache = opts.clearCache
  }

  async start(): Promise<void> {
    let chokidar: typeof import('chokidar')
    try {
      chokidar = await import('chokidar')
    } catch {
      return // chokidar not available, skip HRR
    }

    this.depGraph = new Map()
    for (const dir of this.apiDirs) {
      const graph = await generateDependencyGraph(dir, process.cwd())
      for (const [k, v] of graph) {
        this.depGraph.set(k, v)
      }
    }

    const watchDirs = this.apiDirs.map((dir) => {
      return path.dirname(dir) // e.g. src/http -> src, http -> .
    })

    // De-duplicate watchDirs
    const uniqueWatchDirs = Array.from(new Set(watchDirs)).map((d) =>
      path.resolve(process.cwd(), d)
    )

    this.watcher = chokidar.watch(uniqueWatchDirs, {
      ignoreInitial: true,
      ignored: ['**/node_modules/**', '**/.exis/**'],
    })

    this.watcher.on('change', async (filePath: string) => {
      await this.handleFileChange(filePath)
    })

    this.watcher.on('add', async (filePath: string) => {
      if (this.isRouteFile(filePath)) {
        this.handleAdd(filePath)
      }
    })

    this.watcher.on('unlink', (filePath: string) => {
      if (this.isRouteFile(filePath)) {
        this.handleDelete(filePath)
      }
    })
  }

  private isRouteFile(filePath: string): boolean {
    const base = path.basename(filePath)
    return base === 'route.ts' || base === 'route.js'
  }

  private isGatewayFile(filePath: string): boolean {
    const base = path.basename(filePath)
    return base === 'gateway.ts' || base === 'gateway.js'
  }

  private async handleFileChange(filePath: string): Promise<void> {
    const normalized = path.resolve(filePath)

    if (this.isRouteFile(normalized)) {
      return this.handleChange(normalized)
    }

    if (this.isGatewayFile(normalized)) {
      const gatewayDir = path.dirname(normalized)
      this.invalidateCache(normalized)
      for (const [routeFile] of this.routeMap) {
        if (routeFile.startsWith(gatewayDir)) {
          await this.handleChange(routeFile)
        }
      }
      return
    }

    if (this.depGraph.has(normalized)) {
      const dependents = this.depGraph.get(normalized)!
      if (dependents.size > 0) {
        this.invalidateCache(normalized)
        for (const routeFile of dependents) {
          await this.handleChange(routeFile)
        }
      }
    }
  }

  private async handleChange(filePath: string): Promise<void> {
    const start = performance.now()
    const normalized = path.resolve(filePath)
    const routePath = this.routeMap.get(normalized)

    if (!routePath) {
      // Unknown route file, try to compute the route path
      return this.handleAdd(filePath)
    }

    // 1. Remove old routes from this file
    this.router.removeRoutesBySource(normalized)

    // 2. Clear the module cache so we get a fresh import
    this.invalidateCache(normalized)

    // 3. Re-import and mount
    try {
      await this.mountRoute(normalized, routePath)

      // Update dependency graph
      this.depGraph = new Map()
      for (const dir of this.apiDirs) {
        const graph = await generateDependencyGraph(dir, process.cwd())
        for (const [k, v] of graph) {
          this.depGraph.set(k, v)
        }
      }

      const elapsed = Math.round(performance.now() - start)
      const relative = path
        .relative(process.cwd(), normalized)
        .replace(/\\/g, '/')
      console.log(
        `${ts()} ${c.green}HMR:${c.reset} Reloaded ${c.cyan}${relative}${c.reset} in ${elapsed}ms`
      )
    } catch (err) {
      formatDevError(err as Error, normalized)
    }
  }

  private async handleAdd(filePath: string): Promise<void> {
    const normalized = path.resolve(filePath)

    // Compute the route path from the file path
    const routePath = this.filePathToRoutePath(normalized)
    if (!routePath) return

    this.routeMap.set(normalized, routePath)

    try {
      this.invalidateCache(normalized)
      await this.mountRoute(normalized, routePath)

      // Update dependency graph for the new file
      this.depGraph = new Map()
      for (const dir of this.apiDirs) {
        const graph = await generateDependencyGraph(dir, process.cwd())
        for (const [k, v] of graph) {
          this.depGraph.set(k, v)
        }
      }

      const relative = path
        .relative(process.cwd(), normalized)
        .replace(/\\/g, '/')
      console.log(
        `${ts()} ${c.green}HMR:${c.reset} Added route ${c.cyan}${relative}${c.reset} → ${c.yellow}${routePath}${c.reset}`
      )
    } catch (err) {
      formatDevError(err as Error, normalized)
    }
  }

  private handleDelete(filePath: string): void {
    const normalized = path.resolve(filePath)
    const removed = this.router.removeRoutesBySource(normalized)
    this.routeMap.delete(normalized)

    if (removed > 0) {
      const relative = path
        .relative(process.cwd(), normalized)
        .replace(/\\/g, '/')
      console.log(
        `${ts()} ${c.red}HMR:${c.reset} Removed route ${c.cyan}${relative}${c.reset} (${removed} handler${removed > 1 ? 's' : ''})`
      )
    }
  }

  private invalidateCache(filePath: string): void {
    // Clear CommonJS cache
    const resolved = require.resolve(filePath)
    if (resolved && require.cache[resolved]) {
      delete require.cache[resolved]
    }

    // For ESM, we append a cache-busting query param on the import URL
    // This is handled in the mountRoute function

    this.clearCache()
  }

  private filePathToRoutePath(filePath: string): string | null {
    let matchedApiDir: string | null = null
    for (const dir of this.apiDirs) {
      if (filePath.startsWith(path.resolve(dir))) {
        matchedApiDir = dir
        break
      }
    }
    if (!matchedApiDir) return null

    const relative = path.relative(matchedApiDir, filePath).replace(/\\/g, '/')
    // Remove route.ts / route.js from the end
    const dir = path.dirname(relative)

    let routePath = '/api'
    if (dir !== '.') {
      const segments = dir.split('/').map((segment) => {
        // Skip (group) folders
        if (segment.startsWith('(') && segment.endsWith(')')) return null
        // [...slug] catch-all
        if (segment.startsWith('[...') && segment.endsWith(']')) {
          return '*' + segment.slice(4, -1)
        }
        // [id] dynamic param
        return segment.replace(/\[(.*?)\]/g, ':$1')
      })

      const validSegments = segments.filter(Boolean)
      if (validSegments.length > 0) {
        routePath += '/' + validSegments.join('/')
      }
    }

    return routePath
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }
}
