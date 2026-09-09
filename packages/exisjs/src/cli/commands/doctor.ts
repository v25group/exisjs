import path from 'node:path'
import fs from 'node:fs'
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

  if (majorNode >= 18) {
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
      message: `${nodeVer} is below minimum supported v18.0.0`,
      hint: 'Upgrade Node.js to v18, v20, or v22 for full N-API and crypto support.',
    })
  }

  // 2. Hardware-Accelerated Native Engine (@exisjs/rs) Check
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rs = require('@exisjs/rs')
    const hasRadix = typeof rs.NativeRadixTree === 'function'
    const hasFastJson = typeof rs.fast_json_stringify === 'function'

    if (hasRadix && hasFastJson) {
      results.push({
        category: 'Native Engine',
        name: '@exisjs/rs (Rust Engine)',
        status: 'pass',
        message:
          'Active (hardware-accelerated radix tree, off-heap cache & fast JSON)',
      })
    } else {
      results.push({
        category: 'Native Engine',
        name: '@exisjs/rs (Rust Engine)',
        status: 'warn',
        message:
          'Loaded, but some native symbols are unavailable. Fallbacks active.',
        hint: 'Rebuild native bindings using "npm run build --workspace=packages/rs".',
      })
    }
  } catch {
    results.push({
      category: 'Native Engine',
      name: '@exisjs/rs (Rust Engine)',
      status: 'warn',
      message:
        'Not loaded. Framework running in graceful pure-JS fallback mode.',
      hint: 'Run "npm install @exisjs/rs" or build from source to unlock 10x off-heap routing performance.',
    })
  }

  // 3. Project Configuration & Directory Structure Check
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
    const routeFiles = allFiles.filter(
      (f) =>
        f.endsWith('route.ts') ||
        f.endsWith('route.js') ||
        /\.route\.[jt]s$/.test(f)
    )
    const schemaFiles = allFiles.filter(
      (f) =>
        f.endsWith('schema.ts') ||
        f.endsWith('schema.js') ||
        /\.schema\.[jt]s$/.test(f)
    )
    const boundaryFiles = allFiles.filter(
      (f) =>
        f.endsWith('boundary.ts') ||
        f.endsWith('boundary.js') ||
        /\.boundary\.[jt]s$/.test(f)
    )

    results.push({
      category: 'Routes & Pipeline',
      name: 'File-System Route Slices',
      status: 'pass',
      message: `Discovered ${routeFiles.length} route(s), ${schemaFiles.length} schema(s), ${boundaryFiles.length} boundary definition(s)`,
    })

    // Check for suspicious naming like route.controller.ts or routes.ts (plural)
    const suspicious = allFiles.filter((f) => {
      const base = path.basename(f)
      return (
        base === 'routes.ts' ||
        base === 'routes.js' ||
        base === 'controller.ts' ||
        base === 'controllers.ts'
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
        hint: 'ExisJS detects route.ts, <name>.route.ts, schema.ts, or boundary.ts. Plural "routes.ts" will not be mounted automatically.',
      })
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
