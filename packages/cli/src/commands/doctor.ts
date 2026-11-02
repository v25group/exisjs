import path from 'node:path'
import fs from 'node:fs'
import {
  assertOneBoundaryFilePerFolder,
  assertOneRouteFilePerFolder,
  isBoundaryFile,
  isRouteFile,
} from 'exisjs/internal'
import { c, banner } from '../utils'

interface CheckResult {
  category: string
  name: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  hint?: string
}

export async function doctorCommand(
  cwd: string = process.cwd()
): Promise<void> {
  banner()
  console.log(
    `${c.primary}${c.bold}  ExisJS Health & Diagnostic Doctor${c.reset}\n`
  )

  const results: CheckResult[] = []

  // 1. Environment & Node.js Version Check
  const nodeVer = process.version
  const majorNode = parseInt(nodeVer.replace(/^v/, '').split('.')[0], 10)

  if (majorNode >= 20) {
    results.push({
      category: 'Runtime',
      name: 'Node.js Version',
      status: 'pass',
      message: `${nodeVer} (compatible with ExisJS core & worker threads)`,
    })
  } else {
    results.push({
      category: 'Runtime',
      name: 'Node.js Version',
      status: 'fail',
      message: `${nodeVer} is below minimum supported v20.0.0`,
      hint: 'Upgrade Node.js to v20 or newer (an active LTS release is recommended).',
    })
  }

  // 2. Project Configuration & Directory Structure Check
  const pkgPath = path.join(cwd, 'package.json')
  if (fs.existsSync(pkgPath)) {
    results.push({
      category: 'Project',
      name: 'package.json',
      status: 'pass',
      message: 'Found project root',
    })
  } else {
    results.push({
      category: 'Project',
      name: 'package.json',
      status: 'fail',
      message: 'No package.json detected in current directory',
      hint: 'Run "exis init" or execute doctor inside your ExisJS project folder.',
    })
  }

  const tsconfigPath = path.join(cwd, 'tsconfig.json')
  if (fs.existsSync(tsconfigPath)) {
    try {
      const tsconfigContent = fs.readFileSync(tsconfigPath, 'utf8')
      results.push({
        category: 'TypeScript',
        name: 'tsconfig.json',
        status: 'pass',
        message: 'TypeScript configuration detected',
      })

      if (
        tsconfigContent.includes('"strict": true') ||
        tsconfigContent.includes('"strict":true')
      ) {
        results.push({
          category: 'TypeScript',
          name: 'Strict Type Checking',
          status: 'pass',
          message: 'Strict mode is enabled',
        })
      } else {
        results.push({
          category: 'TypeScript',
          name: 'Strict Type Checking',
          status: 'warn',
          message: '"strict" is disabled or not set in tsconfig.json',
          hint: 'Set "compilerOptions.strict: true" for complete compile-time route and schema validation.',
        })
      }
    } catch {
      results.push({
        category: 'TypeScript',
        name: 'tsconfig.json',
        status: 'warn',
        message: 'Could not parse tsconfig.json',
      })
    }
  } else {
    results.push({
      category: 'TypeScript',
      name: 'tsconfig.json',
      status: 'warn',
      message: 'No tsconfig.json found. Running in JavaScript mode.',
      hint: 'Add a tsconfig.json to unlock full type-safety and OpenAPI schema resolution.',
    })
  }

  // 4. Entry Point & Route Files Check
  const possibleEntries = [
    path.join(cwd, 'src', 'http', 'server.ts'),
    path.join(cwd, 'src', 'http', 'server.js'),
    path.join(cwd, 'http', 'server.ts'),
    path.join(cwd, 'http', 'server.js'),
  ]
  const resolvedEntry = possibleEntries.find((p) => fs.existsSync(p))

  if (resolvedEntry) {
    const relEntry = path.relative(cwd, resolvedEntry).replace(/\\/g, '/')
    results.push({
      category: 'Routes & Pipeline',
      name: 'Application Entry Point',
      status: 'pass',
      message: `Resolved entry at ${relEntry}`,
    })
  } else {
    results.push({
      category: 'Routes & Pipeline',
      name: 'Application Entry Point',
      status: 'fail',
      message:
        'Could not find entry file (expected src/http/server.ts or http/server.ts)',
      hint: 'Scaffold a server entry point using "exis generate route users" or create src/http/server.ts.',
    })
  }

  // Check HTTP directory
  const httpDirs = [path.join(cwd, 'src', 'http'), path.join(cwd, 'http')]
  const activeHttpDir = httpDirs.find(
    (d) => fs.existsSync(d) && fs.statSync(d).isDirectory()
  )

  if (activeHttpDir) {
    // Scan for misplaced route files or orphan naming patterns
    const walk = (dir: string): string[] => {
      let files: string[] = []
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            files = files.concat(walk(full))
          } else {
            files.push(full)
          }
        }
      } catch {
        /* ignore */
      }
      return files
    }

    const allFiles = walk(activeHttpDir)
    const routeFiles = allFiles.filter((f) => isRouteFile(f))
    const schemaFiles = allFiles.filter(
      (f) =>
        f.endsWith('schema.ts') ||
        f.endsWith('schema.js') ||
        /\.schema\.[jt]s$/.test(f)
    )
    const boundaryFiles = allFiles.filter((f) => isBoundaryFile(f))
    const errorFiles = allFiles.filter(
      (f) =>
        f.endsWith('error.ts') ||
        f.endsWith('error.js') ||
        /\.error\.[jt]s$/.test(f)
    )

    results.push({
      category: 'Routes & Pipeline',
      name: 'File-System Route Slices',
      status: 'pass',
      message: `Discovered ${routeFiles.length} route(s), ${schemaFiles.length} schema(s), ${boundaryFiles.length} boundary definition(s)${errorFiles.length > 0 ? `, ${errorFiles.length} global error handler(s)` : ''}`,
    })

    // Check for suspicious naming like route.controller.ts or routes.ts (plural)
    const suspicious = allFiles.filter((f) => {
      const base = path.basename(f)
      return (
        base === 'routes.ts' ||
        base === 'routes.js' ||
        base === 'controller.ts' ||
        base === 'controllers.ts' ||
        // Named like a route or boundary, but the scanner doesn't load it
        (/(route|boundary)\.[jt]s$/.test(base) &&
          !isRouteFile(base) &&
          !isBoundaryFile(base))
      )
    })

    if (suspicious.length > 0) {
      const rels = suspicious
        .map((f) => path.relative(cwd, f).replace(/\\/g, '/'))
        .join(', ')
      results.push({
        category: 'Routes & Pipeline',
        name: 'Naming Conventions',
        status: 'warn',
        message: `Found non-standard file names: ${rels}`,
        hint: 'ExisJS detects route.ts, <name>.route.ts, schema.ts, boundary.ts, or error.ts. Plural "routes.ts" and names like "reroute.ts" will not be mounted automatically.',
      })
    }

    // One naming style, so editor tabs and search results read the same everywhere
    const plainRoutes = routeFiles.filter((f) =>
      /^route\.[jt]s$/.test(path.basename(f))
    )
    if (plainRoutes.length > 0 && plainRoutes.length < routeFiles.length) {
      results.push({
        category: 'Project Layout',
        name: 'Route File Names',
        status: 'warn',
        message: `${plainRoutes.length} plain route file(s) and ${routeFiles.length - plainRoutes.length} named ones`,
        hint: 'Pick one style. Named files (users/users.route.ts) are recommended.',
      })
    }

    const SERVICE_LINE_LIMIT = 400
    const largeServices = allFiles.filter((f) => {
      if (!/(^|[\\/.])service\.[jt]s$/.test(f)) return false
      const lines = fs.readFileSync(f, 'utf8').split('\n').length
      return lines > SERVICE_LINE_LIMIT
    })
    if (largeServices.length > 0) {
      results.push({
        category: 'Project Layout',
        name: 'Service File Size',
        status: 'warn',
        message: `Over ${SERVICE_LINE_LIMIT} lines: ${largeServices
          .map((f) => path.relative(cwd, f).replace(/\\/g, '/'))
          .join(', ')}`,
        hint: 'Split by topic in the same folder: <topic>.service.ts.',
      })
    }

    // Business rules stay free of HTTP and storage, so anything can reuse and test them
    const domainDir = path.join(path.dirname(activeHttpDir), 'domain')
    const IMPORT_SPEC =
      /(?:\bfrom\s+|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g
    const LAYER_IMPORT = /^(\.{1,2}\/|@\/|~\/|src\/).*?\b(database|http)(\/|$)/
    const impureDomain = walk(domainDir).filter((f) => {
      if (!/\.[jt]s$/.test(f)) return false
      const source = fs.readFileSync(f, 'utf8')
      return [...source.matchAll(IMPORT_SPEC)].some((m) =>
        LAYER_IMPORT.test(m[1])
      )
    })
    if (impureDomain.length > 0) {
      results.push({
        category: 'Project Layout',
        name: 'Pure Domain Code',
        status: 'warn',
        message: `Importing database/ or http/: ${impureDomain
          .map((f) => path.relative(cwd, f).replace(/\\/g, '/'))
          .join(', ')}`,
        hint: 'src/domain/ holds pure functions. Pass the data in from the service.',
      })
    }

    // The server refuses to start on these, so doctor reports them as failures
    for (const check of [
      assertOneRouteFilePerFolder,
      assertOneBoundaryFilePerFolder,
    ]) {
      try {
        check(allFiles)
      } catch (err: any) {
        results.push({
          category: 'Routes & Pipeline',
          name: 'One File Per Folder',
          status: 'fail',
          message: err.message,
        })
      }
    }
  }

  // Print Formatted Report
  let _passCount = 0
  let warnCount = 0
  let failCount = 0

  let currentCategory = ''
  for (const r of results) {
    if (r.category !== currentCategory) {
      currentCategory = r.category
      console.log(`\n  ${c.bold}${c.magenta}${currentCategory}${c.reset}`)
    }

    let badge = `${c.green}✓${c.reset}`
    if (r.status === 'pass') _passCount++
    else if (r.status === 'warn') {
      badge = `${c.yellow}▲${c.reset}`
      warnCount++
    } else {
      badge = `${c.red}✗${c.reset}`
      failCount++
    }

    console.log(
      `    ${badge} ${c.bold}${r.name}${c.reset}: ${c.gray}${r.message}${c.reset}`
    )
    if (r.hint) {
      console.log(`      ${c.cyan}Tip:${c.reset} ${c.dim}${r.hint}${c.reset}`)
    }
  }

  console.log(`\n  ${'─'.repeat(55)}`)
  if (failCount === 0 && warnCount === 0) {
    console.log(
      `  ${c.green}${c.bold}All checks passed!${c.reset} Your ExisJS environment is in optimal condition.\n`
    )
  } else if (failCount === 0) {
    console.log(
      `  ${c.yellow}${c.bold}Passed with ${warnCount} warning(s).${c.reset} System is operational but could be optimized.\n`
    )
  } else {
    console.log(
      `  ${c.red}${c.bold}${failCount} critical issue(s) detected.${c.reset} Please review the suggestions above.\n`
    )
    process.exit(1)
  }
}
