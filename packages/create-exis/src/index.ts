#!/usr/bin/env node

import path from 'node:path'
import fs from 'node:fs'
import * as cp from 'node:child_process'

import {
  packageJsonTemplate,
  tsconfigTemplate,
  exisConfigTemplate,
  serverTemplate,
  healthRouteTemplate,
  envTemplate,
  envTsTemplate,
  gitignoreTemplate,
  readmeTemplate,
  eslintTemplate,
  rootRouteTemplate,
} from './templates.js'

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
}

async function run() {
  const args = process.argv.slice(2)
  const prompts = (await import('prompts')).default

  const isYes = args.includes('-y') || args.includes('--yes')
  let projectName = args.find((arg) => !arg.startsWith('-'))

  if (!projectName) {
    if (isYes) {
      projectName = 'my-exis-app'
    } else {
      const res = await prompts({
        type: 'text',
        name: 'name',
        message: 'What is your project named?',
        initial: 'my-api',
      })
      projectName = res.name
    }
  }

  if (!projectName) {
    process.exit(1)
  }

  // Normalize projectName (e.g. change './' to '.')
  projectName = projectName.trim().replace(/[\\/]+$/, '')
  if (projectName === '') projectName = '.'

  // Support for scaffolding in current directory via "."
  const targetDir =
    projectName === '.'
      ? process.cwd()
      : path.resolve(process.cwd(), projectName)

  const dirName =
    projectName === '.' ? path.basename(process.cwd()) : projectName

  if (
    projectName !== '.' &&
    fs.existsSync(targetDir) &&
    fs.readdirSync(targetDir).length > 0
  ) {
    console.error(
      `\n${c.red}✗${c.reset} Directory ${c.cyan}${projectName}${c.reset} is not empty.`
    )
    process.exit(1)
  }

  // Interactive Prompts
  let useTypeScript = true
  let useSrc = true
  let useEslint = true
  let alias = '@/*'

  if (!isYes) {
    const answers = await prompts([
      {
        type: 'toggle',
        name: 'typescript',
        message: 'Would you like to use TypeScript?',
        initial: true,
        active: 'Yes',
        inactive: 'No',
      },
      {
        type: 'toggle',
        name: 'eslint',
        message: 'Would you like to use ESLint?',
        initial: true,
        active: 'Yes',
        inactive: 'No',
      },
      {
        type: 'toggle',
        name: 'srcDir',
        message: 'Would you like your code inside a `src/` directory?',
        initial: true,
        active: 'Yes',
        inactive: 'No',
      },
      {
        type: 'toggle',
        name: 'customAlias',
        message:
          'Would you like to customize the import alias (`@/*` by default)?',
        initial: false,
        active: 'Yes',
        inactive: 'No',
      },
      {
        type: (prev: unknown) => (prev ? 'text' : null),
        name: 'alias',
        message: 'What import alias would you like configured?',
        initial: '@/*',
        validate: (val: string) =>
          val.endsWith('/*') ? true : 'Import alias must end with /*',
      },
    ])

    if (answers.srcDir === undefined) {
      process.exit(1)
    }

    useTypeScript = answers.typescript
    useSrc = answers.srcDir
    useEslint = useTypeScript ? answers.eslint : false
    alias = answers.alias || '@/*'
  }

  // Detect package manager
  const userAgent = process.env.npm_config_user_agent || ''
  const pkgManager = userAgent.startsWith('yarn')
    ? 'yarn'
    : userAgent.startsWith('pnpm')
      ? 'pnpm'
      : userAgent.startsWith('bun')
        ? 'bun'
        : 'npm'

  console.log(
    `\nCreating a new Exis JS app in ${c.green}${targetDir}${c.reset}.`
  )
  console.log(`\nUsing ${c.cyan}${pkgManager}${c.reset}.\n`)
  console.log(`Initializing project...`)

  const baseDir = useSrc ? 'src/http' : 'http'

  // Create project structure
  fs.mkdirSync(targetDir, { recursive: true })
  if (useSrc) fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true })

  // Write all template files
  writeTemplates(targetDir, dirName, baseDir, alias, useEslint, useTypeScript)

  const deps = ['exisjs']
  const devDeps = useTypeScript ? ['@types/node', 'typescript'] : []
  if (useEslint) devDeps.push('eslint', '@eslint/js', 'typescript-eslint')

  console.log(`\nInstalling dependencies:`)
  deps.forEach((d) => console.log(`- ${c.cyan}${d}${c.reset}`))

  if (devDeps.length > 0) {
    console.log(`\nInstalling devDependencies:`)
    devDeps.forEach((d) => console.log(`- ${c.cyan}${d}${c.reset}`))
  }
  console.log()

  // Run install natively so the user sees the real progress!
  cp.spawnSync(`${pkgManager} install`, {
    cwd: targetDir,
    stdio: 'inherit',
    shell: true,
  })

  console.log(`
${c.green}${c.bold}✓ Done! Your Exis JS app is ready.${c.reset}

Next steps:
  ${projectName !== '.' ? `${c.cyan}cd ${projectName}${c.reset}\n  ` : ''}${c.cyan}${pkgManager === 'npm' ? 'npm run dev' : pkgManager + ' dev'}${c.reset}
`)
}

run().catch((err) => {
  console.error(`\n${c.red}Failed to create project:${c.reset}`, err.message)
  process.exit(1)
})

// ─── Template Writers ─────────────────────────────────────────────────────────

function writeTemplates(
  dir: string,
  name: string,
  baseDir: string,
  alias: string,
  useEslint: boolean,
  useTypeScript: boolean
): void {
  const isSrc = baseDir.startsWith('src')
  const ext = useTypeScript ? 'ts' : 'js'

  write(
    dir,
    'package.json',
    packageJsonTemplate(name, useEslint, useTypeScript)
  )

  if (useTypeScript) {
    write(dir, 'tsconfig.json', tsconfigTemplate(isSrc, alias))
  }

  write(dir, `exis.config.${ext}`, exisConfigTemplate(useTypeScript))
  write(dir, `env.${ext}`, envTsTemplate(useTypeScript))

  write(dir, `${baseDir}/server.${ext}`, serverTemplate())
  write(dir, `${baseDir}/route.${ext}`, rootRouteTemplate())
  write(dir, `${baseDir}/health/route.${ext}`, healthRouteTemplate())

  write(dir, '.env', envTemplate())
  write(dir, '.gitignore', gitignoreTemplate())
  write(dir, 'README.md', readmeTemplate(name))

  if (useEslint) {
    write(dir, 'eslint.config.mjs', eslintTemplate())
  }
}

function write(dir: string, file: string, content: string): void {
  const fullPath = path.join(dir, file)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content, 'utf8')
}
