import fs from 'node:fs'
import path from 'node:path'
import { c, error, success } from '../utils'

interface MigrateOptions {
  dryRun?: boolean
}

export interface MigrationChange {
  file: string
  description: string
}

// What a container should run: the binary itself, with no npm in between
export const START_CMD = 'CMD ["node_modules/.bin/exisjs", "start"]'

function cliVersion(): string {
  try {
    const pkg = path.join(__dirname, '..', '..', 'package.json')
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version
  } catch {
    return 'latest'
  }
}

function installedTypeScript(cwd: string): string | null {
  try {
    const pkg = require.resolve('typescript/package.json', { paths: [cwd] })
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version
  } catch {
    return null
  }
}

/**
 * Updates package.json for the 0.10 layout: the CLI as a development
 * dependency, and TypeScript listed by the project itself. `exisjs start`
 * keeps working: the runtime runs it without the CLI. Returns what changed.
 */
export function migratePackageJson(
  cwd: string,
  write: boolean
): MigrationChange[] {
  const file = path.join(cwd, 'package.json')
  const text = fs.readFileSync(file, 'utf8')
  const pkg = JSON.parse(text)
  const changes: MigrationChange[] = []
  const has = (name: string) =>
    Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name])

  if (!has('@exisjs/cli')) {
    const range = cliVersion() === 'latest' ? 'latest' : `^${cliVersion()}`
    pkg.devDependencies = { ...pkg.devDependencies, '@exisjs/cli': range }
    changes.push({
      file: 'package.json',
      description: `devDependencies: add "@exisjs/cli": "${range}"`,
    })
  }

  // exisjs used to install TypeScript for the project; the CLI only borrows it
  if (fs.existsSync(path.join(cwd, 'tsconfig.json')) && !has('typescript')) {
    const version = installedTypeScript(cwd)
    const range = version ? `^${version}` : '^5.9.3'
    pkg.devDependencies = { ...pkg.devDependencies, typescript: range }
    changes.push({
      file: 'package.json',
      description: `devDependencies: add "typescript": "${range}"`,
    })
  }

  if (write && changes.length > 0) {
    const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? '  '
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const out = JSON.stringify(pkg, null, indent).replace(/\n/g, eol) + eol
    fs.writeFileSync(file, out, 'utf8')
  }
  return changes
}

/** Dockerfile lines that should change; the file is not edited */
export function dockerfileAdvice(cwd: string): string[] {
  const file = path.join(cwd, 'Dockerfile')
  if (!fs.existsSync(file)) return []
  const advice: string[] = []
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    const n = `Dockerfile:${i + 1}`
    // npm between the platform and the server turns SIGTERM into an error
    if (/^\s*CMD\b/i.test(line) && /\bnpm\b.*\bstart/.test(line)) {
      advice.push(`${n}: ${START_CMD}   (was: ${line.trim()})`)
    }
    if (
      /npm\s+(ci|install)\b.*--omit=dev/.test(line) &&
      !/--omit=optional/.test(line)
    ) {
      advice.push(
        `${n}: add --omit=optional so the build tooling stays out of the image   (was: ${line.trim()})`
      )
    }
  })
  return advice
}

export async function migrateCommand(
  options: MigrateOptions = {}
): Promise<void> {
  const cwd = process.cwd()
  if (!fs.existsSync(path.join(cwd, 'package.json'))) {
    error('No package.json in this directory.')
    process.exit(1)
  }

  const changes = migratePackageJson(cwd, !options.dryRun)
  const docker = dockerfileAdvice(cwd)

  if (changes.length === 0 && docker.length === 0) {
    success('This project already uses the @exisjs/cli layout.')
    return
  }

  if (changes.length > 0) {
    console.log(
      `\n${c.bold}${options.dryRun ? 'Would change' : 'Changed'}:${c.reset}`
    )
    for (const ch of changes)
      console.log(`  ${c.green}•${c.reset} ${ch.description}`)
  }
  if (docker.length > 0) {
    console.log(`\n${c.bold}Update by hand:${c.reset}`)
    for (const line of docker) console.log(`  ${c.yellow}•${c.reset} ${line}`)
  }
  if (!options.dryRun && changes.length > 0) {
    console.log(
      `\nNext: run ${c.cyan}npm install${c.reset}, then ${c.cyan}npm run build${c.reset} and ${c.cyan}npm start${c.reset} to check the server starts.\n`
    )
  }
}
