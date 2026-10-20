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

const START_BIN = 'node_modules/.bin/exisjs start'

/** Deployment-file lines that should change; the files are not edited */
export function dockerfileAdvice(cwd: string): string[] {
  const advice: string[] = []
  const check = (
    name: string,
    test: (line: string, at: string) => void
  ): void => {
    const file = path.join(cwd, name)
    if (!fs.existsSync(file)) return
    fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => test(line, `${name}:${i + 1}`))
  }
  // npm between the platform and the server turns SIGTERM into an error
  const npmStart = /\bnpm\b.*\bstart\b/
  // `npm run build` runs the project's build script, usually `exisjs build`
  let buildScript = ''
  try {
    buildScript =
      JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'))
        .scripts?.build ?? ''
  } catch {
    /* no build script */
  }
  const npmRunBuild = /\bnpm\s+run\s+build\b/
  const buildNeedsSkip = (line: string): boolean => {
    if (/--skip-env-check/.test(line)) return false
    if (/\bexisjs\s+build\b/.test(line)) return true
    return (
      npmRunBuild.test(line) &&
      /\bexisjs\s+build\b/.test(buildScript) &&
      !/--skip-env-check/.test(buildScript)
    )
  }
  const skipAdvice = (at: string, line: string): string =>
    `${at}: add --skip-env-check (npm run build -- --skip-env-check); secrets are not set while the image builds   (was: ${line.trim()})`

  check('Dockerfile', (line, at) => {
    if (/^\s*CMD\b/i.test(line) && npmStart.test(line)) {
      advice.push(`${at}: ${START_CMD}   (was: ${line.trim()})`)
    }
    if (
      /npm\s+(ci|install)\b.*--omit=dev/.test(line) &&
      !/--omit=optional/.test(line)
    ) {
      advice.push(
        `${at}: add --omit=optional so the build tooling stays out of the image   (was: ${line.trim()})`
      )
    }
    if (/^\s*RUN\b/i.test(line) && buildNeedsSkip(line)) {
      advice.push(skipAdvice(at, line))
    }
  })
  check('nixpacks.toml', (line, at) => {
    if (/^\s*cmd\s*=/.test(line) && npmStart.test(line)) {
      advice.push(`${at}: cmd = "${START_BIN}"   (was: ${line.trim()})`)
    }
    if (!/^\s*#/.test(line) && buildNeedsSkip(line)) {
      advice.push(skipAdvice(at, line))
    }
  })
  check('Procfile', (line, at) => {
    if (/^\s*web\s*:/.test(line) && npmStart.test(line)) {
      advice.push(`${at}: web: ${START_BIN}   (was: ${line.trim()})`)
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
