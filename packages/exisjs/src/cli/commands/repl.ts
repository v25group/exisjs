import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { error, c } from '../utils'

interface ReplOptions {
  entry?: string
}

export async function replCommand(options: ReplOptions = {}): Promise<void> {
  const cwd = process.cwd()

  const entryFile = resolveEntry(cwd, options.entry)
  if (!entryFile) {
    error(
      'Could not find entry file. Expected src/http/server.ts or http/server.ts'
    )
    process.exit(1)
  }

  // Build environment
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NODE_ENV: 'development',
    FORCE_COLOR: '1',
    __EXIS_CLI: 'true',
    __EXIS_REPL: 'true',
    EXIS_ENTRY_FILE: entryFile,
  }

  const startReplPath = path.join(__dirname, '../../lib/start-repl.js')

  // Use tsx to run the repl
  const runner = {
    name: 'tsx',
    bin: process.execPath,
    args: [require.resolve('tsx/cli')],
  }

  console.log(`\n${c.cyan}[exis]${c.reset} starting interactive console...`)

  const child = spawn(runner.bin, [...runner.args, startReplPath], {
    cwd,
    env,
    stdio: 'inherit',
    shell: runner.bin === process.execPath ? false : true,
  })

  child.on('error', (err) => {
    error(`Failed to start REPL: ${err.message}`)
  })

  child.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
      if (code === 128 + 15 || code === 143) {
        return
      }
      process.exit(code ?? 1)
    } else {
      process.exit(0)
    }
  })
}

function resolveEntry(cwd: string, custom?: string): string | null {
  if (custom) {
    const abs = path.resolve(cwd, custom)
    return fs.existsSync(abs) ? abs : null
  }

  const srcTs = path.join(cwd, 'src/http/server.ts')
  const srcJs = path.join(cwd, 'src/http/server.js')
  const rootTs = path.join(cwd, 'http/server.ts')
  const rootJs = path.join(cwd, 'http/server.js')

  if (fs.existsSync(srcTs)) return srcTs
  if (fs.existsSync(srcJs)) return srcJs
  if (fs.existsSync(rootTs)) return rootTs
  if (fs.existsSync(rootJs)) return rootJs

  return null
}
