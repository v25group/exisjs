import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { error, c } from '../utils'
import { generateManifest } from '../manifest.js'
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

  const tscBin = findTsc(cwd)
  if (!tscBin) {
    error('TypeScript compiler not found.')
    error('Install it: npm install -D typescript')
    process.exit(1)
  }

  await new Promise<void>((resolve, reject) => {
    const typeRootsDir = path.join(cwd, 'node_modules', '@types')
    const command = `"${tscBin}" --project "${tsconfigPath}" --outDir "${outDir}" --noEmit false --typeRoots "${typeRootsDir}"`
    const child = spawn(command, {
      cwd,
      stdio: 'pipe',
      shell: true,
    })

    let stderr = ''
    let stdout = ''

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })

    child.on('exit', (code) => {
      if (code !== 0) {
        // print TypeScript errors clearly
        const output = stderr || stdout
        if (output) {
          console.log(`\n${c.red}TypeScript errors:${c.reset}`)
          console.log(output)
        }

        reject(new Error(`BUILD_OPTIMIZATION_FAILED`))
        return
      }
      process.stdout.write(
        `\r${c.green}✓${c.reset} ${c.dim}compiled in ${Date.now() - start}ms.${c.reset}\n`
      )
      resolve()
    })
  }).catch((err) => {
    console.error('')
    if (
      err instanceof Error &&
      (err.message === 'BUILD_OPTIMIZATION_FAILED' ||
        err.message === 'WEBPACK_ERRORS')
    ) {
      error(`> ${err.message}`)
      process.exit(1)
    } else {
      console.error('> Build error occurred')
      error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

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

function findTsc(cwd: string): string | null {
  const local = path.join(cwd, 'node_modules', '.bin', 'tsc')
  if (fs.existsSync(local)) return local

  const cliLocal = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'node_modules',
    '.bin',
    'tsc'
  )
  if (fs.existsSync(cliLocal)) return cliLocal

  return 'tsc'
}

async function fixPathAliases(cwd: string, outDir: string): Promise<void> {
  try {
    await resolvePathAliases(cwd, outDir)
  } catch (err: any) {
    process.stdout.write(
      `\n${c.yellow}⚠${c.reset} ${c.dim}alias resolution failed: ${err.message}${c.reset}\n`
    )
  }
}
