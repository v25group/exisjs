import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { error, c } from '../utils'
import { getFormattedTime } from '../../utils/time'

interface StartOptions {
  entry?: string
  port?: string
  host?: string
}

export async function startCommand(options: StartOptions = {}): Promise<void> {
  const cwd = process.cwd()

  const entryFile = resolveDistEntry(cwd, options.entry)

  if (!entryFile) {
    error('No compiled output found.')
    error(`Run ${c.cyan}exis build${c.reset} first.`)
    process.exit(1)
  }

  if (options.port) {
    process.env.PORT = options.port
  }
  if (options.host) {
    process.env.HOST = options.host
  }

  const startServerPath = path.join(__dirname, '../../lib/start-server.js')

  process.env.NODE_ENV = 'production'
  process.env.__EXIS_CLI = 'true'
  process.env.EXIS_ENTRY_FILE = entryFile

  const child = spawn(process.execPath, [startServerPath], {
    cwd,
    env: process.env,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    shell: false,
  })

  child.on('error', (err) => {
    error(`Failed to start: ${err.message}`)
    process.exit(1)
  })

  let isShuttingDown = false

  let hasExited = false
  const finishExit = () => {
    if (hasExited) return
    hasExited = true
    const time = getFormattedTime()
    const primary = '\x1b[38;2;160;70;255m'
    console.log(
      `${c.dim}${time}${c.reset} ${primary}[exis]${c.reset} ${c.dim}gracefully shutting down server...${c.reset}`
    )
    process.exit(0)
  }

  child.on('close', finishExit)
  child.on('exit', () => {
    // Fallback: give 'close' event a moment to fire (stdio drain), then exit
    setTimeout(finishExit, 300)
  })

  // Handle unexpected child crashes (non-shutdown)
  child.on('exit', (code, signal) => {
    if (!isShuttingDown) {
      if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
        error(`Process exited with code ${code}`)
        process.exit(code ?? 1)
      }
    }
  })

  const shutdown = () => {
    if (isShuttingDown) return
    isShuttingDown = true

    // Send IPC shutdown message to child
    try {
      if (child.connected) {
        child.send({ type: 'exis:shutdown' })
      }
    } catch {
      /* ignore */
    }

    // Disconnect IPC channel to prevent UV_HANDLE_CLOSING assertion on Windows
    try {
      if (child.connected) {
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

    // Safety timeout: force exit if child takes longer than 10s.
    // IMPORTANT: Do NOT .unref() — this keeps the parent event loop alive
    // so we wait for the child to finish its graceful shutdown before exiting.
    const forceTimeout = setTimeout(() => {
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
      process.exit(0)
    }, 10_000)

    // Clean up force timeout when child exits naturally
    child.once('exit', () => clearTimeout(forceTimeout))
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

function resolveDistEntry(cwd: string, custom?: string): string | null {
  if (custom) {
    const abs = path.resolve(cwd, custom)
    return fs.existsSync(abs) ? abs : null
  }

  const srcJs = path.join(cwd, '.exis/server/src/http/server.js')
  const rootJs = path.join(cwd, '.exis/server/http/server.js')
  const distSrcJs = path.join(cwd, 'dist/src/http/server.js')
  const distRootJs = path.join(cwd, 'dist/http/server.js')
  const rawSrcJs = path.join(cwd, 'src/http/server.js')
  const rawRootJs = path.join(cwd, 'http/server.js')

  const hasSrc =
    fs.existsSync(srcJs) || fs.existsSync(distSrcJs) || fs.existsSync(rawSrcJs)
  const hasRoot =
    fs.existsSync(rootJs) ||
    fs.existsSync(distRootJs) ||
    fs.existsSync(rawRootJs)

  if (hasSrc && hasRoot) {
    console.error(
      '\n\x1b[31m Ambiguous Entry Point Error\x1b[0m\n' +
        'You have server entry files in both "src/http" and "http" directories.\n' +
        'Please keep only one of them to prevent unexpected behavior.\n'
    )
    process.exit(1)
  }

  if (fs.existsSync(srcJs)) return srcJs
  if (fs.existsSync(rootJs)) return rootJs
  if (fs.existsSync(distSrcJs)) return distSrcJs
  if (fs.existsSync(distRootJs)) return distRootJs
  if (fs.existsSync(rawSrcJs)) return rawSrcJs
  if (fs.existsSync(rawRootJs)) return rawRootJs

  return null
}
