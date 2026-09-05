import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { error, c } from '../utils'
import { generateManifest, generateExisEnv } from '../manifest.js'
import { resolvePathAliases } from '../resolve-aliases.js'

interface BuildOptions {
  outDir?: string
  clean?: boolean
}

export async function buildCommand(options: BuildOptions = {}): Promise<void> {
  process.env.__EXIS_BUILD = 'true'

  process.on('SIGINT', () => {
    const time = new Date()
      .toLocaleTimeString('en-US', {
        hour12: true,
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      })
      .toLowerCase()
    const primary = '\x1b[38;2;160;70;255m'
    console.log(
      `\n${c.dim}${time}${c.reset} ${primary}[exis]${c.reset} ${c.dim}build cancelled.${c.reset}`
    )
    process.exit(0)
  })

  const cwd = process.cwd()
  const outDir = options.outDir ?? '.exis/server'
  const tsconfigPath = path.join(cwd, 'tsconfig.json')

  let version = '0.0.0'
  try {
    const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json')
    version = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version
  } catch {
    /* ignore */
  }

  // Validate tsconfig
  if (!fs.existsSync(tsconfigPath)) {
    console.log(
      `\n${c.primary}EXIS v${version}${c.reset} ${c.green}building server environment for production...${c.reset}`
    )
    console.log(
      `${c.yellow}No tsconfig.json found. Skipping build for native JS project.${c.reset}`
    )
    console.log(`\n  Run ${c.primary}exis start${c.reset} to serve the app.\n`)
    return
  }

  console.log(
    `\n${c.primary}EXIS v${version}${c.reset} ${c.green}building server environment for production...${c.reset}`
  )

  // Clean .exis/server
  if (options.clean !== false) {
    const serverPath = path.join(cwd, outDir)
    if (fs.existsSync(serverPath)) {
      process.stdout.write(`${c.dim}cleaning...${c.reset}`)
      fs.rmSync(serverPath, { recursive: true, force: true })
      process.stdout.write(
        `\r${c.green}✓${c.reset} ${c.dim}cleaned output directory.${c.reset}\n`
      )
    }
  }

  process.stdout.write(`${c.dim}compiling...${c.reset}`)
  const start = Date.now()

  // Ensure we generate the exis.d.ts file with optional fallback node types BEFORE tsc runs
  await generateExisEnv(cwd)

  let ts: any
  try {
    const req = typeof require !== 'undefined' ? require : eval('require')
    const tsPath = req.resolve('typescript', { paths: [cwd, __dirname] })
    ts = req(tsPath)
  } catch {
    error('TypeScript compiler not found in project.')
    error('Install it: npm install -D typescript')
    process.exit(1)
  }

  // Normalize path for TS on Windows
  const tsconfigPathForTs = tsconfigPath.replace(/\\/g, '/')
  const configFile = ts.readConfigFile(tsconfigPathForTs, ts.sys.readFile)
  if (configFile.error) {
    error('Error reading tsconfig.json')
    process.exit(1)
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPathForTs)
  )

  const entryPoints = parsedConfig.fileNames.filter(
    (f: string) => !f.endsWith('.d.ts')
  )

  let format = 'cjs'
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')
    )
    if (pkg.type === 'module') format = 'esm'
  } catch {
    // default to cjs if package.json is missing or unparseable
  }

  // ─── TypeScript Type-Check ─────────────────────────────────────────────────
  // Run the TS compiler in check-only mode (no emit) to catch type errors,
  // broken imports, and syntax errors BEFORE esbuild runs.
  if (process.env.NODE_ENV !== 'test') {
    process.stdout.write(`${c.dim}type-checking...${c.reset}`)
    const program = ts.createProgram(parsedConfig.fileNames, {
      ...parsedConfig.options,
      noEmit: true,
    })
    const diagnostics = [
      ...parsedConfig.errors,
      ...ts.getPreEmitDiagnostics(program),
    ]
    if (diagnostics.length > 0) {
      process.stdout.write('\n')
      const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (f: string) => f,
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getNewLine: () => '\n',
      })
      process.stderr.write(formatted + '\n')
      error(`TYPE_CHECK_FAILED: ${diagnostics.length} error(s) found.`)
      console.error(
        `\n${c.yellow}  Fix the errors above, then run ${c.reset}${c.primary}exis build${c.reset}${c.yellow} again.${c.reset}\n`
      )
      process.exit(1)
    }
  }
  if (process.env.NODE_ENV === 'test') {
    process.stdout.write(
      `\r${c.yellow}↷${c.reset} ${c.dim}type-check skipped in test environment.${c.reset}\n`
    )
  } else {
    process.stdout.write(
      `\r${c.green}✓${c.reset} ${c.dim}type-check passed.${c.reset}\n`
    )
  }

  // ─── esbuild Compilation ───────────────────────────────────────────────────
  process.stdout.write(`${c.dim}compiling...${c.reset}`)
  try {
    const esbuild = await import('esbuild')
    await esbuild.build({
      entryPoints,
      outdir: path.join(cwd, outDir),
      platform: 'node',
      format: format as 'cjs' | 'esm',
      bundle: false,
      logLevel: 'error',
    })

    process.stdout.write(
      `\r${c.green}✓${c.reset} ${c.dim}compiled via esbuild in ${Date.now() - start}ms.${c.reset}\n`
    )
  } catch (err: any) {
    console.error('')
    error(`COMPILE_FAILED: ${err?.message ?? 'esbuild encountered an error'}`)
    process.exit(1)
  }

  // resolve path aliases natively (no external deps)
  await fixPathAliases(cwd, outDir)

  // Generate the .exis/manifest.js route map
  try {
    await generateManifest(cwd, outDir)
  } catch (err: any) {
    console.error('')
    error(`ROUTE_SCAN_FAILED: ${err.message}`)
    console.error(
      `\n${c.yellow}  Fix the routing errors above, then run ${c.reset}${c.primary}exis build${c.reset}${c.yellow} again.${c.reset}\n`
    )
    process.exit(1)
  }

  // ─── Build-time Validation ──────────────────────────────────────────────────
  // Eagerly import the generated manifest to catch route-level configuration
  // errors (e.g. missing cache keyGenerator, invalid middleware options) NOW,
  // at build time, rather than letting them crash the production server on first
  // request or startup.
  process.stdout.write(`${c.dim}validating routes...${c.reset}`)
  try {
    const manifestPath = path.join(cwd, '.exis', 'routes-manifest.js')
    if (fs.existsSync(manifestPath)) {
      const dynamicImport = new Function(
        'specifier',
        'return import(specifier)'
      )
      await dynamicImport(pathToFileURL(manifestPath).href)
      process.stdout.write(
        `\r${c.green}✓${c.reset} ${c.dim}all routes validated.${c.reset}\n`
      )
    }
  } catch (err: any) {
    console.error('')
    error(`BUILD_VALIDATION_FAILED: ${err.message}`)
    console.error(
      `\n${c.yellow}  Fix the error above, then run ${c.reset}${c.primary}exis build${c.reset}${c.yellow} again.${c.reset}\n`
    )
    process.exit(1)
  }

  const ms = Date.now() - start

  console.log(`\n${c.green}✓ built in ${ms}ms${c.reset}\n`)

  process.exit(0)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fixPathAliases(cwd: string, outDir: string): Promise<void> {
  try {
    await resolvePathAliases(cwd, outDir)
  } catch (err: any) {
    process.stdout.write(
      `\n${c.yellow}⚠${c.reset} ${c.dim}alias resolution failed: ${err.message}${c.reset}\n`
    )
  }
}
