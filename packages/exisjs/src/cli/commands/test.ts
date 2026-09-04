import { spawn, ChildProcess } from 'node:child_process'
import { c, error } from '../utils'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { pathToFileURL } from 'node:url'

export interface TestOptions {
  watch?: boolean
  update?: boolean
  entry?: string
  files?: string[]
}

function resolveEntry(cwd: string, custom?: string): string {
  if (custom) {
    const abs = path.resolve(cwd, custom)
    if (fs.existsSync(abs)) return abs
  }
  const srcTs = path.join(cwd, 'src/http/server.ts')
  const rootTs = path.join(cwd, 'http/server.ts')
  if (fs.existsSync(srcTs)) return srcTs
  if (fs.existsSync(rootTs)) return rootTs
  return ''
}

export async function testCommand(options: TestOptions): Promise<void> {
  const cwd = process.cwd()

  // Ensure entry file is resolved so we can set EXIS_ENTRY_FILE
  const entryFile = resolveEntry(cwd, options.entry)

  // We are going to spawn tsx with --test
  const runner = {
    name: 'tsx',
    bin: process.execPath,
    args: [require.resolve('tsx/cli')],
  }

  const reporterPath = pathToFileURL(
    path.join(__dirname, '..', '..', 'testing', 'reporter.mjs')
  ).href
  const testArgs = ['--test', '--test-reporter', reporterPath]

  process.env.NODE_ENV = 'test'
  const { loadEnv } = await import('../../config/env.js')
  const { parsedEnv } = loadEnv(cwd, 'test')

  // Load Exis Config
  const { loadConfig } = await import('../../config/config.js')
  let exisConfig: any = {}
  try {
    exisConfig = await loadConfig(cwd)
  } catch {
    /* ignore */
  }
  const testConfig = exisConfig.test || {}

  if (options.watch) {
    testArgs.push('--watch')
  }

  if (options.update) {
    testArgs.push('--test-update-snapshots')
  }

  // Apply configs
  if (testConfig.concurrency) {
    testArgs.push(
      typeof testConfig.concurrency === 'number'
        ? `--test-concurrency=${testConfig.concurrency}`
        : '--test-concurrency'
    )
  }

  if (testConfig.coverage) {
    testArgs.push('--experimental-test-coverage')
  }

  if (testConfig.setupFiles) {
    for (const file of testConfig.setupFiles) {
      testArgs.push('--import', pathToFileURL(path.resolve(cwd, file)).href)
    }
  }

  // If specific files were provided by the user, pass them along
  if (options.files && options.files.length > 0) {
    testArgs.push(...options.files)
  } else if (testConfig.include && testConfig.include.length > 0) {
    testArgs.push(...testConfig.include)
  } else {
    // Prevent workspace symlink traversal by explicitly scoping to tests/ and test/ and src/
    testArgs.push('tests/**/*.test.ts', 'tests/**/*.spec.ts')
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(parsedEnv as Record<string, string>),
    NODE_ENV: 'test',
    FORCE_COLOR: '1',
    __EXIS_CLI: 'true',
    __EXIS_TEST: 'true',
    EXIS_ENTRY_FILE: entryFile,
  }

  let version = '0.0.0'
  try {
    const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json')
    version = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version
  } catch {
    /* ignore */
  }

  // Print minimalist test runner banner
  const primary = '\x1b[38;2;160;70;255m'
  console.log(
    `\n  ${primary}${c.bold}EXIS TEST RUNNER${c.reset} ${c.dim}v${version}${c.reset}`
  )
  console.log(`  ${c.dim}powered by node:test${c.reset}\n`)

  let child: ChildProcess | null = null

  function startProcess(): void {
    if (child) {
      child.kill('SIGTERM')
    }

    child = spawn(runner.bin, [...runner.args, ...testArgs], {
      cwd,
      env,
      stdio: 'inherit',
      // If we use process.execPath (Node binary), shell is typically false
      shell: runner.bin === process.execPath ? false : true,
    })

    child.on('error', (err) => {
      error(`Failed to start test runner: ${err.message}`)
    })

    child.on('exit', (code, signal) => {
      if (signal !== 'SIGTERM' && code !== 0 && code !== null) {
        if (code === 128 + 15 || code === 143) {
          // Normal sigterm exits
          return
        }
        process.exit(code)
      } else if (code === 0) {
        if (!options.watch) {
          process.exit(0)
        }
      }
    })
  }

  startProcess()
}
