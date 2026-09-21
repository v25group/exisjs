import { spawn, spawnSync, ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { pathToFileURL } from 'node:url'
import { error, c, warn } from '../utils'
import { getFormattedTime } from '../../utils/time'
import { loadEnv } from '../../config/env'
import { loadConfig } from '../../config/config'

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

  // 1. Prevent duplicate dev servers using a PID lockfile
  const exisDir = path.join(cwd, '.exis')
  const pidFile = path.join(exisDir, 'dev.pid')

  if (fs.existsSync(pidFile)) {
    try {
      const existingPid = parseInt(fs.readFileSync(pidFile, 'utf-8'), 10)
      if (existingPid && existingPid !== process.pid) {
        try {
          process.kill(existingPid, 0)
          console.error(
            '\n\x1b[31m[ExisJS] This application is already running in another terminal.\x1b[0m\n' +
              'Stop the existing development server before starting a new one.'
          )
          process.exit(1)
        } catch {
          // Process not running, safe to proceed
        }
      }
    } catch {
      // Ignore read error
    }
  }

  if (!fs.existsSync(exisDir)) fs.mkdirSync(exisDir, { recursive: true })
  fs.writeFileSync(pidFile, String(process.pid))

  // 2. Load .env files early so process.env.PORT is available
  loadEnv(cwd)

  // 3. Read exis.config.ts to pick up user-defined port
  const userConfig = await loadConfig(cwd)

  // 4. Automatic Port Finding — priority: CLI flag > env > config > default(4000)
  const startPort = parseInt(
    options.port || process.env.PORT || String(userConfig.port) || '4000',
    10
  )

  function findAvailablePort(port: number): Promise<number> {
    return new Promise((resolve) => {
      const server = net.createServer()
      server.listen(port, () => {
        server.once('close', () => resolve(port))
        server.close()
      })
      server.on('error', () => {
        resolve(findAvailablePort(port + 1))
      })
    })
  }

  const actualPort = await findAvailablePort(startPort)

  // Check for tsconfig (only warn for TypeScript projects)
  const tsconfigPath = path.join(cwd, 'tsconfig.json')
  if (!fs.existsSync(tsconfigPath) && entryFile.endsWith('.ts')) {
    warn('No tsconfig.json found — using default TypeScript settings.')
  }

  process.env.PORT = String(actualPort)
  if (options.host) {
    process.env.HOST = options.host
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
  const time = getFormattedTime()
  console.log(
    `\n${c.dim}${time}${c.reset} ${primary}[exis]${c.reset} ${c.dim}starting development server (v${version})...${c.reset}`
  )

  // Hardcode Esbuild (tsx) as the Native HMR runner
  let tsxArgs = [require.resolve('tsx/cli')]
  try {
    const resolved = require.resolve('tsx', { paths: [cwd, __dirname] })
    tsxArgs = ['--import', pathToFileURL(resolved).href]
  } catch {
    /* fallback to tsx/cli if resolve fails */
  }

  const runner = {
    name: 'tsx',
    bin: process.execPath,
    args: tsxArgs,
    needsManualWatch: true,
  }

  let child: ChildProcess | null = null
  let isShuttingDown = false
  let watcher: any = null

  function cleanupPid() {
    try {
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile)
      }
    } catch {
      /* ignore */
    }
  }

  let forceExitTriggered = false

  async function handleSessionStop(_signal: string) {
    if (isShuttingDown) {
      if (!forceExitTriggered) {
        forceExitTriggered = true
        cleanupPid()
        if (child && child.pid) {
          try {
            if (process.platform === 'win32') {
              spawnSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], {
                stdio: 'ignore',
              })
            } else {
              child.kill('SIGKILL')
            }
          } catch {
            /* ignore */
          }
        }
        process.exit(0)
      }
      return
    }

    isShuttingDown = true
    cleanupPid()

    const time = getFormattedTime()
    const primary = '\x1b[38;2;160;70;255m'
    console.log(
      `\n${c.dim}${time}${c.reset} ${primary}[exis]${c.reset} ${c.dim}gracefully shutting down server...${c.reset}`
    )

    if (watcher) {
      try {
        watcher.close()
      } catch {
        /* ignore */
      }
      watcher = null
    }

    if ((global as any)._tscProcess) {
      try {
        ;(global as any)._tscProcess.kill()
      } catch {
        /* ignore */
      }
    }

    if (
      child &&
      child.pid &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      try {
        if (child.connected) {
          child.send({ type: 'exis:shutdown' })
          child.disconnect()
        }
      } catch {
        /* ignore */
      }

      try {
        if (process.platform !== 'win32') {
          child.kill('SIGTERM')
        }
      } catch {
        /* ignore */
      }

      const exitTimeout = setTimeout(() => {
        try {
          if (child && !child.killed) {
            if (process.platform === 'win32') {
              spawnSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], {
                stdio: 'ignore',
              })
            } else {
              child.kill('SIGKILL')
            }
          }
        } catch {
          /* ignore */
        }
        process.exit(0)
      }, 2000)

      const onChildDone = () => {
        clearTimeout(exitTimeout)
        process.exit(0)
      }

      child.once('close', onChildDone)
      child.once('exit', onChildDone)
    } else {
      process.exit(0)
    }
  }

  process.on('SIGINT', () => handleSessionStop('SIGINT'))
  process.on('SIGTERM', () => handleSessionStop('SIGTERM'))

  let fallbackServer: http.Server | null = null

  function closeFallbackServer() {
    if (fallbackServer) {
      try {
        fallbackServer.close()
      } catch {
        /* ignore */
      }
      fallbackServer = null
    }
  }

  let configuredPort: number | null = null
  try {
    const configTs = path.join(cwd, 'exis.config.ts')
    const configJs = path.join(cwd, 'exis.config.js')
    const configFile = fs.existsSync(configTs)
      ? configTs
      : fs.existsSync(configJs)
        ? configJs
        : null
    if (configFile) {
      const content = fs.readFileSync(configFile, 'utf8')
      const match = content.match(/\bport\s*:\s*(\d+)/)
      if (match) {
        configuredPort = parseInt(match[1], 10)
      }
    }
  } catch {
    /* ignore */
  }

  function startFallbackServer(errorMessage: string, customPort?: number) {
    closeFallbackServer()
    const port =
      customPort ??
      (process.env.PORT ? parseInt(process.env.PORT, 10) : configuredPort) ??
      4000
    fallbackServer = http.createServer((req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/html' })
      res.end(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Build Error | Exis</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #fcebeb; color: #333; margin: 0; padding: 40px; }
    .container { max-width: 900px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 10px 25px rgba(200, 0, 0, 0.1); border-left: 6px solid #e53e3e; }
    h1 { color: #e53e3e; margin-top: 0; font-size: 24px; }
    .code-block { background: #1e1e1e; color: #fc8181; padding: 20px; border-radius: 6px; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Build/Syntax Error</h1>
    <div class="code-block">${errorMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </div>
</body>
</html>
      `)
    })
    fallbackServer
      .listen(port, () => {
        console.log(
          `\n${c.red}[exis] Serving build error on port ${port}${c.reset}`
        )
      })
      .on('error', () => {
        // Port might still be in use by zombie process, just ignore
      })
  }

  let isRestarting = false
  let pendingRestart = false
  let reloadDebounceTimer: NodeJS.Timeout | null = null
  const queuedChangedFiles = new Set<string>()
  const RELOAD_DEBOUNCE_MS = 150
  const RELOAD_TIMEOUT_MS = 3000

  async function killChildGracefully(): Promise<void> {
    if (!child || child.killed) return

    // 1. Send IPC shutdown message so the child can run app.close() / onClose hooks
    try {
      if (child.connected) {
        child.send({ type: 'exis:shutdown' })
      }
    } catch {
      /* ignore — child may have already exited */
    }

    // 2. Disconnect the IPC channel IMMEDIATELY after sending the shutdown message.
    //    On Windows, this is CRITICAL: it closes the parent's end of the IPC pipe
    //    before the child starts tearing down its libuv handles, preventing the
    //    UV_HANDLE_CLOSING assertion crash in src\win\async.c.
    try {
      if (child.connected) {
        child.disconnect()
      }
    } catch {
      /* ignore — channel may already be closed */
    }

    // 3. On non-Windows, also send SIGTERM as a direct signal
    try {
      if (process.platform !== 'win32') {
        child.kill('SIGTERM')
      }
    } catch {
      /* ignore */
    }

    // 4. Wait for clean exit with a generous graceful timeout (3000ms).
    //    Child will usually exit in ~50-200ms once onClose finishes.
    await new Promise<void>((resolve) => {
      let resolved = false
      const onExitOrClose = () => {
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        resolve()
      }

      const timer = setTimeout(() => {
        if (resolved) return
        resolved = true
        // Timeout expired — force kill the child process tree
        if (child && !child.killed) {
          try {
            if (process.platform === 'win32') {
              spawnSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], {
                stdio: 'ignore',
              })
            } else {
              child.kill('SIGKILL')
            }
          } catch {
            /* ignore */
          }
        }
        resolve()
      }, RELOAD_TIMEOUT_MS)

      child!.once('close', onExitOrClose)
      child!.once('exit', onExitOrClose)
    })
  }

  async function startProcess(): Promise<void> {
    if (isRestarting) {
      pendingRestart = true
      return
    }
    isRestarting = true
    closeFallbackServer()

    await killChildGracefully()

    child = spawn(runner!.bin, [...runner!.args, startServerPath], {
      cwd,
      env: {
        ...env,
        __EXIS_DEV_SERVER: '1',
        __EXIS_IS_RESTART: (global as any)._hasStartedBefore ? '1' : '',
        EXIS_ENTRY_FILE: entryFile!,
      },
      stdio: ['inherit', 'inherit', 'pipe', 'ipc'],
      shell: runner!.bin === process.execPath ? false : true,
    })

    ;(global as any)._hasStartedBefore = true

    let stderrBuffer = ''

    child!.stderr?.on('data', (chunk) => {
      const str = chunk.toString()
      process.stderr.write(chunk)
      stderrBuffer += str
      // Keep only last 10000 chars to avoid memory leak
      if (stderrBuffer.length > 10000) {
        stderrBuffer = stderrBuffer.substring(stderrBuffer.length - 10000)
      }
    })

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
        // Start the fallback server so the browser doesn't hang or get "Connection Refused"
        startFallbackServer(
          stderrBuffer || 'Process crashed with no error output.'
        )
      }
    })

    isRestarting = false

    // If more file changes arrived while we were restarting, trigger consolidated reload
    if (pendingRestart) {
      pendingRestart = false
      startProcess()
    }
  }

  function scheduleReload(file?: string) {
    if (file) {
      queuedChangedFiles.add(file)
    }

    if (reloadDebounceTimer) {
      clearTimeout(reloadDebounceTimer)
    }

    reloadDebounceTimer = setTimeout(async () => {
      reloadDebounceTimer = null
      const files = Array.from(queuedChangedFiles)
      queuedChangedFiles.clear()

      const time = getFormattedTime()
      const primary = '\x1b[38;2;160;70;255m'
      const fileLabel =
        files.length === 1
          ? files[0]
          : files.length > 1
            ? `${files[0]} (+${files.length - 1} other files)`
            : 'file changes'

      console.log(
        `${c.dim}${time}${c.reset} ${primary}[exis]${c.reset} ${c.dim}reloading due to change in ${fileLabel}${c.reset}`
      )

      await generateManifest(cwd, '', true)
      startProcess()
    }, RELOAD_DEBOUNCE_MS)
  }

  // Handle restarts for runners that don't support watch natively
  if (runner.needsManualWatch && !options._disableWatch) {
    const chokidar = await importChokidar()
    if (chokidar) {
      watcher = chokidar.watch([cwd], {
        cwd,
        ignoreInitial: true,
        ignored: [
          // eslint-disable-next-line no-useless-escape
          /(^|[\/\\])\../, // ignore dotfiles (.git, .vscode, .idea, etc.)
          /node_modules/,
          /\.exis/,
          /dist/,
          /build/,
          /exis\.d\.ts$/,
          /\.(rar|zip|7z|tar|gz|tgz|bz2|xz|iso)$/i, // compressed archives
          /\.(bak|tmp|temp|swp|swo|lock|pid)$/i, // temporary and lock files
          /\.(log|log\.\d+|sqlite|sqlite3|db|db-shm|db-wal|db-journal)$/i, // logs and databases
          /\.(png|jpe?g|gif|svg|ico|webp|avif|mp4|webm|mov|mp3|wav|pdf|docx?|xlsx?|pptx?)$/i, // media & binary docs
        ],
      })

      watcher.on('error', (err: any) => {
        // Suppress non-fatal Windows file lock / permission errors (EBUSY / EPERM)
        if (
          err?.code === 'EBUSY' ||
          err?.code === 'EPERM' ||
          err?.code === 'UNKNOWN'
        ) {
          return
        }
        console.warn(
          `\x1b[33m[exis watcher notice]\x1b[0m ${err?.message || err}`
        )
      })

      watcher.on('all', async (eventName: string, file: string) => {
        if (
          /\.(rar|zip|7z|tar|gz|tgz|bz2|xz|iso|bak|tmp|temp|swp|swo|lock|pid|log|sqlite|sqlite3|db|png|jpe?g|gif|svg|ico|webp|pdf)$/i.test(
            file
          )
        ) {
          return
        }
        scheduleReload(file)
      })
    }
  }

  // Generate dev manifest for O(1) booting
  const { generateManifest } = await import('../manifest')
  await generateManifest(cwd, '', true)

  if (fs.existsSync(tsconfigPath)) {
    let tscPath: string
    try {
      const req = typeof require !== 'undefined' ? require : eval('require')
      tscPath = req.resolve('typescript/bin/tsc', { paths: [cwd] })
    } catch {
      error('TypeScript compiler not found in project.')
      error('Install it: npm install -D typescript')
      process.exit(1)
    }
    const tscProcess = spawn(
      process.execPath,
      [tscPath, '--noEmit', '--watch', '--preserveWatchOutput'],
      { cwd, env: process.env }
    )
    ;(global as any)._tscProcess = tscProcess

    let tscErrors: string[] = []

    tscProcess.stdout?.on('data', (data) => {
      const lines = data.toString().trim().split('\n')

      const getTime = () => {
        return getFormattedTime()
      }

      for (const line of lines) {
        if (!line) continue
        if (line.includes('Found 0 errors')) {
          tscErrors = []
          // Type errors are cleared — close the fallback so the real server can serve
          closeFallbackServer()
        } else if (line.includes('error TS')) {
          const time = getTime()
          console.error(`\n${c.red}${time} ERROR:${c.reset} ${line}`)
          tscErrors.push(line)
        } else if (line.includes('Found') && line.includes('error')) {
          // "Found X errors." summary line
          const time = getTime()
          console.error(`\n${c.yellow}${time} INFO:${c.reset} ${line}`)
          if (tscErrors.length > 0) {
            startFallbackServer(
              `TypeScript Compilation Errors\n${'─'.repeat(50)}\n\n` +
                tscErrors.join('\n')
            )
          }
        } else if (
          !line.includes('Starting compilation in watch mode') &&
          !line.includes('File change detected')
        ) {
          const time = getTime()
          console.error(`${c.yellow}${time} INFO:${c.reset} ${line}`)
        }
      }
    })
  }

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
        const time = getFormattedTime()
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
