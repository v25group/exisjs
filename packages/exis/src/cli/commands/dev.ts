import { spawn, ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { log, error, c, warn } from '../utils'

interface DevOptions {
  port?: string
  host?: string
  entry?: string
  _disableWatch?: boolean
}

export async function devCommand(options: DevOptions = {}): Promise<void> {
  const cwd = process.cwd()
  let startServerPath = ''
  try {
    startServerPath = require.resolve('../../lib/start-server')
  } catch {
    startServerPath = require.resolve('../../lib/start-server.ts')
  }

  // Detect entry file
  const entryFile = resolveEntry(cwd, options.entry)
  if (!entryFile) {
    error(
      'Could not find entry file. Expected src/http/server.ts or http/server.ts'
    )
    error('Run this command from your Exis JS project root.')
    process.exit(1)
  }

  // Check for tsconfig
  const tsconfigPath = path.join(cwd, 'tsconfig.json')
  if (!fs.existsSync(tsconfigPath)) {
    warn('No tsconfig.json found — using default TypeScript settings.')
  }

  if (options.port) {
    process.env.PORT = options.port
  }

  // Build environment
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NODE_ENV: 'development',
    FORCE_COLOR: '1',
  }

  let version = '0.0.0'
  try {
    const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json')
    version = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version
  } catch {
    /* ignore */
  }

  const primary = '\x1b[38;2;160;70;255m'
  const time = new Date()
    .toLocaleTimeString('en-US', {
      hour12: true,
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    })
    .toLowerCase()
  console.log(
    `\n${c.dim}${time}${c.reset} ${primary}[exis]${c.reset} ${c.dim}starting development server (v${version})...${c.reset}`
  )

  // Hardcode Esbuild (tsx) as the Native HMR runner
  const runner = {
    name: 'tsx',
    bin: process.execPath,
    args: [require.resolve('tsx/cli')],
    needsManualWatch: true,
  }

  let child: ChildProcess | null = null
  let isShuttingDown = false

  const CHILD_EXIT_TIMEOUT_MS = 1000

  async function handleSessionStop(_signal: string) {
    if (isShuttingDown) return
    isShuttingDown = true

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
      `\n${c.dim}${time}${c.reset} ${primary}[exis]${c.reset} ${c.dim}gracefully shutting down server...${c.reset}`
    )

    if (child && child.pid) {
      const exitTimeout = setTimeout(() => {
        if (child && !child.killed) {
          console.log(
            `${c.red}  Force killing process after timeout...${c.reset}`
          )
          try {
            if (process.platform !== 'win32') {
              child.kill('SIGKILL')
            }
          } catch {
            /* ignore */
          }
        }
        process.exit(0)
      }, CHILD_EXIT_TIMEOUT_MS)

      child.on('exit', () => {
        clearTimeout(exitTimeout)
        process.exit(0)
      })

      try {
        if (process.platform !== 'win32') {
          child.kill('SIGTERM')
        }
      } catch {
        /* ignore */
      }
    } else {
      process.exit(0)
    }
  }

  process.on('SIGINT', () => handleSessionStop('SIGINT'))
  process.on('SIGTERM', () => handleSessionStop('SIGTERM'))

  function startProcess(): void {
    if (child) {
      child.kill('SIGTERM')
    }

    child = spawn(runner!.bin, [...runner!.args, startServerPath], {
      cwd,
      env: {
        ...env,
        __EXIS_DEV_SERVER: '1',
        EXIS_ENTRY_FILE: entryFile!,
      },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      shell: runner!.bin === process.execPath ? false : true,
    })

    // Using env vars for entry file so wrapper tools like tsx don't break IPC

    child!.on('error', (err) => {
      error(`Failed to start process: ${err.message}`)
    })

    child!.on('exit', (code, signal) => {
      if (
        !isShuttingDown &&
        signal !== 'SIGTERM' &&
        code !== 0 &&
        code !== null
      ) {
        if (code === 128 + 15 || code === 143) {
          // Normal sigterm exits
          return
        }
        error(`Process crashed with code ${code}`)
      }
    })
  }

  // Handle restarts for runners that don't support watch natively
  if (runner.needsManualWatch && !options._disableWatch) {
    const chokidar = await importChokidar()
    if (chokidar) {
      const watcher = chokidar.watch([cwd], {
        cwd,
        ignoreInitial: true,
        ignored: [
          // eslint-disable-next-line no-useless-escape
          /(^|[\/\\])\../, // ignore dotfiles
          '**/node_modules/**',
          '**/.exis/**',
          '**/dist/**',
          '**/exis.d.ts',
          'exis.d.ts',
        ],
      })

      watcher.on('change', async (file: string) => {
        log(`Reloading due to change in ${c.cyan}${file}${c.reset}`)
        await generateManifest(cwd, '', true)
        startProcess()
      })
    }
  }

  // Generate dev manifest for O(1) booting
  const { generateManifest } = await import('../manifest')
  await generateManifest(cwd, '', true)

  startProcess()

  // CLI Shortcuts
  if (process.stdin.isTTY) {
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (data) => {
      const key = data.toString().trim().toLowerCase()

      if (key === 'h') {
        console.log(`
  ${c.bold}Shortcuts${c.reset}
  ${c.dim}press${c.reset} ${c.bold}r + enter${c.reset} ${c.dim}to restart the server${c.reset}
  ${c.dim}press${c.reset} ${c.bold}u + enter${c.reset} ${c.dim}to show server url${c.reset}
  ${c.dim}press${c.reset} ${c.bold}c + enter${c.reset} ${c.dim}to clear console${c.reset}
  ${c.dim}press${c.reset} ${c.bold}q + enter${c.reset} ${c.dim}to quit${c.reset}
`)
      } else if (key === 'r') {
        const time = new Date()
          .toLocaleTimeString('en-US', {
            hour12: true,
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
          })
          .toLowerCase()
        console.log(
          `\n${c.dim}${time}${c.reset} ${primary}[exis]${c.reset} ${c.dim}restarting server...${c.reset}`
        )
        startProcess()
      } else if (key === 'c') {
        console.clear()
      } else if (key === 'q') {
        handleSessionStop('SIGINT')
      } else if (key === 'u') {
        // Just trigger a dummy reload so app.ts prints the URL again
        // Or send an IPC message, but since child.kill('SIGUSR2') isn't set up, we can just restart it
        startProcess()
      }
    })
    process.stdin.unref()
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveEntry(cwd: string, custom?: string): string | null {
  if (custom) {
    const abs = path.resolve(cwd, custom)
    return fs.existsSync(abs) ? abs : null
  }

  const srcTs = path.join(cwd, 'src/http/server.ts')
  const srcJs = path.join(cwd, 'src/http/server.js')
  const rootTs = path.join(cwd, 'http/server.ts')
  const rootJs = path.join(cwd, 'http/server.js')

  const hasSrc = fs.existsSync(srcTs) || fs.existsSync(srcJs)
  const hasRoot = fs.existsSync(rootTs) || fs.existsSync(rootJs)

  if (hasSrc && hasRoot) {
    console.error(
      '\n\x1b[31m Ambiguous Entry Point Error\x1b[0m\n' +
        'You have server entry files in both "src/http" and "http" directories.\n' +
        'Please keep only one of them to prevent unexpected behavior.\n'
    )
    process.exit(1)
  }

  if (fs.existsSync(srcTs)) return srcTs
  if (fs.existsSync(srcJs)) return srcJs
  if (fs.existsSync(rootTs)) return rootTs
  if (fs.existsSync(rootJs)) return rootJs

  return null
}

async function importChokidar(): Promise<typeof import('chokidar') | null> {
  try {
    return await import('chokidar')
  } catch {
    return null
  }
}
