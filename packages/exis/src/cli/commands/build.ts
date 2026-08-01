import path from 'node:path'
import fs from 'node:fs'
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
  } catch {
    console.error('')
    error(`> BUILD_OPTIMIZATION_FAILED`)
    process.exit(1)
  }

  // resolve path aliases natively (no external deps)
  await fixPathAliases(cwd, outDir)

  // Generate the .exis/manifest.js route map
  await generateManifest(cwd, outDir)

  process.stdout.write(`${c.dim}running production optimizers...${c.reset}`)
  try {
    const { optimizeRoutes } = await import('../optimizers/aot-routes')
    const { treeShakeMiddleware } = await import('../optimizers/tree-shake')
    const { precompileSerializers } =
      await import('../optimizers/precompile-serializers')

    await optimizeRoutes(cwd, outDir)
    await treeShakeMiddleware(cwd, outDir)
    await precompileSerializers(cwd, outDir)
    process.stdout.write(
      `\r${c.green}✓${c.reset} ${c.dim}production optimizers applied.${c.reset}\n`
    )
  } catch (err) {
    console.error(err)
    process.stdout.write(
      `\r${c.yellow}⚠${c.reset} ${c.dim}some optimizers failed, falling back to dynamic boot.${c.reset}\n`
    )
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
