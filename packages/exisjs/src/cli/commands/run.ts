import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { loadEnv } from '../../config/env'
import { error } from '../utils'

interface RunOptions {
  env?: string
  mode?: string
}

export async function runCommand(
  scriptOrCmd: string,
  args: string[] = [],
  options: RunOptions = {}
): Promise<void> {
  const cwd = process.cwd()

  // 1. Automatically load .env, .env.local, .env.[mode], etc. into process.env
  loadEnv(cwd, options.mode)

  if (options.env) {
    const customEnvPath = path.resolve(cwd, options.env)
    if (fs.existsSync(customEnvPath)) {
      try {
        const { parseEnv } = await import('../../config/env')
        const parsed = parseEnv(fs.readFileSync(customEnvPath, 'utf-8'))
        Object.assign(process.env, parsed)
      } catch (err: any) {
        error(`Failed to load custom env file: ${err.message}`)
      }
    }
  }

  // 2. Check if script is a file or npm command / executable
  const isTsFile =
    scriptOrCmd.endsWith('.ts') ||
    scriptOrCmd.endsWith('.mts') ||
    fs.existsSync(path.resolve(cwd, scriptOrCmd))

  let executable: string
  let execArgs: string[]

  if (isTsFile) {
    // Resolve tsx for seamless TypeScript execution
    let tsxCli: string
    try {
      tsxCli = require.resolve('tsx/cli')
    } catch {
      tsxCli = 'tsx'
    }
    executable = process.execPath
    execArgs = [tsxCli, scriptOrCmd, ...args]
  } else {
    // Run external command (e.g. drizzle-kit, prisma, custom script)
    executable = scriptOrCmd
    execArgs = args
  }

  const child = spawn(executable, execArgs, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  child.on('error', (err) => {
    error(`Failed to execute command "${scriptOrCmd}": ${err.message}`)
    process.exit(1)
  })

  child.on('exit', (code) => {
    process.exit(code ?? 0)
  })
}
