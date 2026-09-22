import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as crypto from 'node:crypto'

export async function atomicWriteFile(
  filePath: string,
  content: string
): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmpPath = path.join(
    dir,
    `.tmp_${path.basename(filePath)}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
  )
  await fs.writeFile(tmpPath, content, 'utf8')
  try {
    await fs.rename(tmpPath, filePath)
  } catch {
    await fs.copyFile(tmpPath, filePath)
    await fs.unlink(tmpPath).catch(() => {
      /* ignore */
    })
  }
}

export async function generateManifest(
  cwd: string,
  outDir: string,
  isDev = false
): Promise<void> {
  const exisDir = path.join(cwd, '.exis')

  // Ensure .exis exists
  try {
    await fs.mkdir(exisDir, { recursive: true })
  } catch {
    // ignore
  }

  // ─── 1. Find HTTP Routes Directory ──────────────────────────────────────────
  const searchDirs = isDev
    ? [path.join(cwd, 'src', 'http'), path.join(cwd, 'http')]
    : [
        path.join(cwd, outDir, 'src', 'http'),
        path.join(cwd, outDir, 'http'),
        path.join(cwd, 'src', 'http'),
      ]

  let apiDir = ''
  for (const dir of searchDirs) {
    try {
      const stat = await fs.stat(dir)
      if (stat.isDirectory()) {
        apiDir = dir
        break
      }
    } catch {
      /* ignore */
    }
  }

  const validRoutes: { filePath: string; routePath: string }[] = []
  if (apiDir) {
    const routes = await scanDirectory(apiDir, '/')
    for (const r of routes) {
      if (
        r.filePath.endsWith('route.ts') ||
        r.filePath.endsWith('route.js') ||
        /\.route\.[jt]s$/.test(r.filePath)
      ) {
        validRoutes.push(r)
      }
    }
  }

  let importLines = ''
  let exportLines = 'export const manifest = [\n'

  let typeImportLines = ''
  let typeFlatLines = 'export interface AppRouterPaths {\n'

  for (let i = 0; i < validRoutes.length; i++) {
    const route = validRoutes[i]
    let relativePath = path
      .relative(exisDir, route.filePath)
      .replace(/\\/g, '/')
    if (!relativePath.startsWith('.')) {
      relativePath = './' + relativePath
    }

    if (!isDev) {
      relativePath = relativePath.replace(/\.ts$/, '.js')
    }

    const moduleName = `route_${i}`
    importLines += `import * as ${moduleName} from '${relativePath}'\n`

    const typeRelativePath = relativePath.replace(/\.(js|ts)$/, '')
    typeImportLines += `import type * as Route${i} from '${typeRelativePath}'\n`

    let hash = '00000000'
    try {
      const content = await fs.readFile(route.filePath, 'utf8')
      hash = crypto
        .createHash('sha256')
        .update(content)
        .digest('hex')
        .substring(0, 8)
    } catch {
      // ignore
    }

    const rootRelativePath = path
      .relative(cwd, route.filePath)
      .replace(/\\/g, '/')
    exportLines += `  { routePath: '${route.routePath}', module: ${moduleName}, filePath: '${rootRelativePath}', hash: '${hash}' },\n`

    typeFlatLines += `  '${route.routePath}': InferRoute<typeof Route${i}>\n`
  }

  exportLines += ']\n'
  typeFlatLines += '}\n'

  // ─── 2. Scan Error Handler File ─────────────────────────────────────────────
  let errorHandlerImport = ''
  let errorHandlerExport = 'export const errorHandler = null\n'

  if (apiDir) {
    const candidateErrorFiles = [
      path.join(apiDir, 'error.ts'),
      path.join(apiDir, 'error.js'),
    ]
    let foundErrorFile = ''
    for (const f of candidateErrorFiles) {
      if (
        await fs
          .stat(f)
          .then((s) => s.isFile())
          .catch(() => false)
      ) {
        foundErrorFile = f
        break
      }
    }
    if (foundErrorFile) {
      let relErrorPath = path
        .relative(exisDir, foundErrorFile)
        .replace(/\\/g, '/')
      if (!relErrorPath.startsWith('.')) {
        relErrorPath = './' + relErrorPath
      }
      if (!isDev) {
        relErrorPath = relErrorPath.replace(/\.ts$/, '.js')
      }
      errorHandlerImport = `import * as errorHandlerModule from '${relErrorPath}'\n`
      errorHandlerExport = `export const errorHandler = errorHandlerModule\n`
    }
  }

  // ─── 3. Scan Cron Job Files ─────────────────────────────────────────────────
  const cronDirs = isDev
    ? [path.join(cwd, 'src', 'cron')]
    : [path.join(cwd, outDir, 'src', 'cron'), path.join(cwd, 'src', 'cron')]

  const discoveredCronFiles: string[] = []
  for (const cDir of cronDirs) {
    try {
      const stat = await fs.stat(cDir)
      if (stat.isDirectory()) {
        const files = await scanAllFiles(cDir)
        for (const f of files) {
          if (!discoveredCronFiles.includes(f)) {
            discoveredCronFiles.push(f)
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Check colocated cron in apiDir
  if (apiDir) {
    const colocatedCronTs = path.join(apiDir, 'cron.ts')
    const colocatedCronJs = path.join(apiDir, 'cron.js')
    if (
      await fs
        .stat(colocatedCronTs)
        .then((s) => s.isFile())
        .catch(() => false)
    ) {
      if (!discoveredCronFiles.includes(colocatedCronTs))
        discoveredCronFiles.push(colocatedCronTs)
    } else if (
      await fs
        .stat(colocatedCronJs)
        .then((s) => s.isFile())
        .catch(() => false)
    ) {
      if (!discoveredCronFiles.includes(colocatedCronJs))
        discoveredCronFiles.push(colocatedCronJs)
    }
  }

  let cronImports = ''
  let cronExports = 'export const cronJobs = [\n'

  for (let cIdx = 0; cIdx < discoveredCronFiles.length; cIdx++) {
    const cronFile = discoveredCronFiles[cIdx]
    let relCronPath = path.relative(exisDir, cronFile).replace(/\\/g, '/')
    if (!relCronPath.startsWith('.')) {
      relCronPath = './' + relCronPath
    }
    if (!isDev) {
      relCronPath = relCronPath.replace(/\.ts$/, '.js')
    }

    const cronModName = `cron_${cIdx}`
    cronImports += `import * as ${cronModName} from '${relCronPath}'\n`

    const rootRelCron = path.relative(cwd, cronFile).replace(/\\/g, '/')
    cronExports += `  { filePath: '${rootRelCron}', module: ${cronModName} },\n`
  }
  cronExports += ']\n'

  // ─── 4. Write Pre-compiled Manifest ─────────────────────────────────────────
  const manifestContent = `// Automatically generated by ExisJS\n\n${importLines}${errorHandlerImport}${cronImports}\n${exportLines}\n${errorHandlerExport}\n${cronExports}`

  if (!isDev) {
    await atomicWriteFile(
      path.join(exisDir, 'routes-manifest.js'),
      manifestContent
    )
  } else {
    try {
      await fs.unlink(path.join(exisDir, 'routes-manifest.js'))
    } catch {
      // ignore
    }
  }

  // ─── 5. Type Generation for AppRouter ───────────────────────────────────────
  const treeRoot = buildRouteTree(
    validRoutes.map((r, idx) => ({ routePath: r.routePath, index: idx }))
  )
  const renderedTree = renderTreeNode(treeRoot)

  const typesContent = `// Automatically generated by ExisJS
// NOTE: This file is automatically generated. Do not edit manually.

export type InferRouteHandler<T> =
  T extends { __type: { body: infer B; query: infer Q; params: infer P; return: infer R } }
    ? {
        [M in (T extends { method: infer Meth extends string } ? Uppercase<Meth> : 'GET')]: (
          payload?: B,
          options?: { query?: Q; params?: P; headers?: Record<string, string> }
        ) => Promise<Awaited<R>>
      } & {
        [M in (T extends { method: infer Meth extends string } ? Lowercase<Meth> : 'get')]: (
          payload?: B,
          options?: { query?: Q; params?: P; headers?: Record<string, string> }
        ) => Promise<Awaited<R>>
      }
    : T extends { [key: string]: any }
      ? {
          [K in keyof T]: T[K] extends { __type: { body: infer B; query: infer Q; params: infer P; return: infer R } }
            ? (
                payload?: B,
                options?: { query?: Q; params?: P; headers?: Record<string, string> }
              ) => Promise<Awaited<R>>
            : T[K] extends (...args: any[]) => infer R
              ? (...args: any[]) => Promise<Awaited<R>>
              : T[K]
        }
      : T extends (...args: any[]) => infer R
        ? {
            GET: (...args: any[]) => Promise<Awaited<R>>
            get: (...args: any[]) => Promise<Awaited<R>>
          }
        : any

export type InferRoute<T> =
  T extends { default: infer D }
    ? InferRouteHandler<D> & (D extends (...args: any[]) => any ? unknown : { [K in Exclude<keyof T, 'default'>]: InferRouteHandler<T[K]> })
    : InferRouteHandler<T>

${typeImportLines}
${typeFlatLines}
export type AppRouterTree = ${renderedTree}

export type AppRouter = AppRouterPaths & AppRouterTree
`

  await atomicWriteFile(path.join(exisDir, 'types.d.ts'), typesContent)

  // Also write to .exis/types/index.d.ts for strict TS module resolution modes
  try {
    const typesSubdir = path.join(exisDir, 'types')
    await atomicWriteFile(path.join(typesSubdir, 'index.d.ts'), typesContent)
  } catch {
    // ignore
  }

  // ─── 6. Real-time Dev Diagnostics ───────────────────────────────────────────
  if (isDev) {
    const devStatus = {
      generatedAt: new Date().toISOString(),
      routeCount: validRoutes.length,
      cronCount: discoveredCronFiles.length,
      hasErrorHandler: Boolean(errorHandlerImport),
      routes: validRoutes.map((r) => ({
        path: r.routePath,
        file: path.relative(cwd, r.filePath).replace(/\\/g, '/'),
      })),
      cronJobs: discoveredCronFiles.map((f) =>
        path.relative(cwd, f).replace(/\\/g, '/')
      ),
      status: 'ok',
    }
    await atomicWriteFile(
      path.join(exisDir, 'dev-status.json'),
      JSON.stringify(devStatus, null, 2)
    )
  }

  await generateExisEnv(cwd)
}

async function scanAllFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await scanAllFiles(full)))
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

interface RouteTreeNode {
  routeIndex?: number
  children: Map<string, RouteTreeNode>
}

function buildRouteTree(
  routes: { routePath: string; index: number }[]
): RouteTreeNode {
  const root: RouteTreeNode = { children: new Map() }

  for (const r of routes) {
    const segments = r.routePath.split('/').filter(Boolean)
    if (segments.length === 0) {
      root.routeIndex = r.index
    } else {
      let current = root
      for (const seg of segments) {
        if (!current.children.has(seg)) {
          current.children.set(seg, { children: new Map() })
        }
        current = current.children.get(seg)!
      }
      current.routeIndex = r.index
    }
  }
  return root
}

function isValidJsIdentifier(name: string): boolean {
  return /^[$A-Z_][0-9A-Z_$]*$/i.test(name)
}

function renderTreeNode(node: RouteTreeNode, indent = 0): string {
  const pad = ' '.repeat(indent)
  const parts: string[] = []

  if (node.routeIndex !== undefined) {
    parts.push(`InferRoute<typeof Route${node.routeIndex}>`)
  }

  if (node.children.size > 0) {
    const childLines: string[] = []
    for (const [seg, childNode] of node.children.entries()) {
      const key = isValidJsIdentifier(seg) ? seg : `'${seg}'`
      const renderedChild = renderTreeNode(childNode, indent + 2)
      childLines.push(`${' '.repeat(indent + 2)}${key}: ${renderedChild}`)
    }
    const childrenType = `{\n${childLines.join('\n')}\n${pad}}`
    parts.push(childrenType)
  }

  if (parts.length === 0) return '{}'
  if (parts.length === 1) return parts[0]
  return `(${parts.join(' & ')})`
}

async function scanDirectory(
  dir: string,
  baseRoute = '/'
): Promise<{ filePath: string; routePath: string }[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const results: { filePath: string; routePath: string }[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      let segment = entry.name

      if (segment.startsWith('(') && segment.endsWith(')')) {
        const subResults = await scanDirectory(fullPath, baseRoute)
        results.push(...subResults)
        continue
      }

      if (segment.startsWith('[...') && segment.endsWith(']')) {
        segment = '*' + segment.slice(4, -1)
      } else {
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

export async function generateExisEnv(cwd: string): Promise<void> {
  const isTsProject = await fs
    .access(path.join(cwd, 'tsconfig.json'))
    .then(() => true)
    .catch(() => false)

  if (!isTsProject) return

  let hasNodeTypes: boolean
  try {
    const req = typeof require !== 'undefined' ? require : eval('require')
    req.resolve('@types/node/package.json', { paths: [cwd, __dirname] })
    hasNodeTypes = true
  } catch {
    hasNodeTypes = await fs
      .access(path.join(cwd, 'node_modules', '@types', 'node'))
      .then(() => true)
      .catch(() => false)
  }

  let envContent = `/// <reference types="exisjs" />

// NOTE: This file should not be edited
// It is automatically generated by ExisJS

// Exposes your compiled routes to the TypeScript server
import type { AppRouter } from './.exis/types'
`

  if (!hasNodeTypes) {
    envContent += `
// Fallback types for production builds where @types/node is pruned
declare var process: any;
declare var console: any;
declare var Buffer: any;
declare var __dirname: string;
declare var __filename: string;
declare var module: any;
declare var exports: any;
declare var require: any;
declare module 'node:*' {
  const x: any;
  export = x;
}
declare module 'fs' {
  const x: any;
  export = x;
}
declare module 'fs/promises' {
  const x: any;
  export = x;
}
declare module 'path' {
  const x: any;
  export = x;
}
declare module 'crypto' {
  const x: any;
  export = x;
}
declare module 'http' {
  const x: any;
  export = x;
}
declare module 'child_process' {
  const x: any;
  export = x;
}
`
  }

  await atomicWriteFile(path.join(cwd, 'exis.d.ts'), envContent)
}
