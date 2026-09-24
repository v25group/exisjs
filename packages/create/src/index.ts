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
  agentsTemplate,
  prettierrcTemplate,
  prettierignoreTemplate,
  commonAuthGuardTemplate,
  dbConnectionTemplate,
  exampleJobTemplate,
  userSchemaTemplate,
  userServiceTemplate,
  rootBoundaryTemplate,
  userRouteTemplate,
  userTestTemplate,
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
  const skipInstall = args.includes('--skip-install')
  const skipGit = args.includes('--skip-git')

  // Explicit CLI flags for non-interactive scripting
  let cliTypeScript: boolean | undefined = undefined
  if (args.includes('--ts') || args.includes('--typescript'))
    cliTypeScript = true
  if (args.includes('--js') || args.includes('--javascript'))
    cliTypeScript = false

  let cliEslint: boolean | undefined = undefined
  if (args.includes('--eslint')) cliEslint = true
  if (args.includes('--no-eslint')) cliEslint = false

  let cliParadigm: string | undefined = undefined
  if (args.includes('--oop')) cliParadigm = 'oop'
  if (args.includes('--functional')) cliParadigm = 'functional'

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

  // Normalize projectName (handling Windows / POSIX slashes and relative dots)
  projectName = projectName.trim().replace(/[\\/]+$/, '')
  if (projectName === '' || projectName === '.') projectName = '.'

  // Guarantee cross-platform path resolution via node:path
  const targetDir =
    projectName === '.'
      ? path.resolve(process.cwd())
      : path.resolve(process.cwd(), projectName)

  const dirName =
    projectName === '.' ? path.basename(targetDir) : path.basename(projectName)

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

  // Interactive Prompts or CLI flag defaults
  let useTypeScript = cliTypeScript !== undefined ? cliTypeScript : true
  let useEslint = cliEslint !== undefined ? cliEslint : true
  let paradigm = cliParadigm || 'functional'
  let alias = '@/*'

  if (!isYes) {
    const questions: any[] = []

    if (cliTypeScript === undefined) {
      questions.push({
        type: 'toggle',
        name: 'typescript',
        message: 'Would you like to use TypeScript?',
        initial: true,
        active: 'Yes',
        inactive: 'No',
      })
    }

    if (cliEslint === undefined) {
      questions.push({
        type: 'toggle',
        name: 'eslint',
        message: 'Would you like to use ESLint?',
        initial: true,
        active: 'Yes',
        inactive: 'No',
      })
    }

    if (!cliParadigm) {
      questions.push({
        type: 'select',
        name: 'paradigm',
        message: 'Which routing paradigm do you prefer?',
        choices: [
          { title: 'Functional (Default)', value: 'functional' },
          { title: 'Class-Based (OOP)', value: 'oop' },
        ],
        initial: 0,
      })
    }

    questions.push({
      type: 'toggle',
      name: 'customAlias',
      message:
        'Would you like to customize the import alias (`@/*` by default)?',
      initial: false,
      active: 'Yes',
      inactive: 'No',
    })

    questions.push({
      type: (prev: unknown) => (prev ? 'text' : null),
      name: 'alias',
      message: 'What import alias would you like configured?',
      initial: '@/*',
      validate: (val: string) =>
        val.endsWith('/*') ? true : 'Import alias must end with /*',
    })

    const answers = await prompts(questions)

    if (
      questions.length > 0 &&
      answers.customAlias === undefined &&
      answers.typescript === undefined &&
      answers.paradigm === undefined
    ) {
      process.exit(1)
    }

    if (answers.typescript !== undefined) useTypeScript = answers.typescript
    if (answers.eslint !== undefined) useEslint = answers.eslint
    if (answers.paradigm) paradigm = answers.paradigm
    if (answers.alias) alias = answers.alias
  }

  // Detect package manager (prioritizing explicit flags, then user-agent, then lockfile search)
  let pkgManager = 'npm'
  if (args.includes('--use-bun')) pkgManager = 'bun'
  else if (args.includes('--use-pnpm')) pkgManager = 'pnpm'
  else if (args.includes('--use-yarn')) pkgManager = 'yarn'
  else if (args.includes('--use-npm')) pkgManager = 'npm'
  else {
    const userAgent = process.env.npm_config_user_agent || ''
    if (userAgent.startsWith('pnpm')) pkgManager = 'pnpm'
    else if (userAgent.startsWith('bun')) pkgManager = 'bun'
    else if (userAgent.startsWith('yarn')) pkgManager = 'yarn'
    else if (userAgent.startsWith('npm')) pkgManager = 'npm'
  }

  console.log(
    `\nCreating a new Exis JS app in ${c.green}${targetDir}${c.reset}.`
  )
  console.log(`\nUsing ${c.cyan}${pkgManager}${c.reset}.\n`)
  console.log(`Initializing project...`)

  // Create project structure with recursive directory creation
  fs.mkdirSync(targetDir, { recursive: true })
  fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true })

  // Write all template files with cross-platform path normalization
  writeTemplates(targetDir, dirName, alias, useEslint, useTypeScript, paradigm)

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

  if (!skipInstall) {
    // Strip npm/pnpm/yarn/bun environment variables to avoid workspace conflicts when spawning install
    const env = { ...process.env }
    for (const key of Object.keys(env)) {
      if (
        key.toLowerCase().startsWith('npm_') ||
        key.toLowerCase().startsWith('pnpm_') ||
        key.toLowerCase().startsWith('yarn_') ||
        key.toLowerCase().startsWith('bun_')
      ) {
        delete env[key]
      }
    }

    // Run install natively so the user sees real progress
    const installCmd =
      pkgManager === 'npm'
        ? 'npm install --no-workspaces'
        : `${pkgManager} install`

    const installResult = cp.spawnSync(installCmd, {
      cwd: targetDir,
      stdio: 'inherit',
      shell: true,
      env,
    })

    if (installResult.status !== 0) {
      console.warn(
        `\n${c.yellow}!${c.reset} Package installation encountered an issue. You can manually install dependencies with: ${c.cyan}${pkgManager} install${c.reset}`
      )
    }
  }

  // Initialize Git Repository safely
  if (!skipGit) {
    try {
      cp.execSync('git init', { cwd: targetDir, stdio: 'ignore' })
      cp.execSync('git add .', { cwd: targetDir, stdio: 'ignore' })
      cp.execSync('git commit -m "Initial commit from Create ExisJS"', {
        cwd: targetDir,
        stdio: 'ignore',
      })
    } catch {
      // Silently continue if git is unavailable in environment
    }
  }

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
  alias: string,
  useEslint: boolean,
  useTypeScript: boolean,
  paradigm: string
): void {
  const ext = useTypeScript ? 'ts' : 'js'
  const baseDir = path.join('src', 'http')
  const srcBase = 'src'

  write(
    dir,
    'package.json',
    packageJsonTemplate(name, useEslint, useTypeScript)
  )

  if (useTypeScript) {
    write(dir, 'tsconfig.json', tsconfigTemplate(alias))
  }

  write(dir, `exis.config.${ext}`, exisConfigTemplate(useTypeScript))
  write(
    dir,
    path.join(srcBase, 'config', `env.${ext}`),
    envTsTemplate(useTypeScript)
  )

  write(
    dir,
    path.join(baseDir, `server.${ext}`),
    serverTemplate(paradigm, useTypeScript)
  )
  write(
    dir,
    path.join(baseDir, `boundary.${ext}`),
    rootBoundaryTemplate(paradigm)
  )
  write(dir, path.join(baseDir, `route.${ext}`), rootRouteTemplate(paradigm))
  write(
    dir,
    path.join(baseDir, 'health', `route.${ext}`),
    healthRouteTemplate(paradigm)
  )

  // Users Feature Module (flat convention: route, schema, service)
  write(
    dir,
    path.join(baseDir, 'users', `route.${ext}`),
    userRouteTemplate(paradigm, useTypeScript)
  )
  write(
    dir,
    path.join(baseDir, 'users', `schema.${ext}`),
    userSchemaTemplate(useTypeScript)
  )
  write(
    dir,
    path.join(baseDir, 'users', `service.${ext}`),
    userServiceTemplate(paradigm, useTypeScript)
  )
  write(
    dir,
    path.join('tests', `users.e2e-spec.${ext}`),
    userTestTemplate(paradigm, useTypeScript)
  )

  // Common, DB, Jobs
  write(
    dir,
    path.join(srcBase, 'common', 'guards', `auth.guard.${ext}`),
    commonAuthGuardTemplate(paradigm, useTypeScript)
  )
  write(
    dir,
    path.join(srcBase, 'database', `db.${ext}`),
    dbConnectionTemplate(useTypeScript)
  )
  write(
    dir,
    path.join(srcBase, 'jobs', `cleanup.job.${ext}`),
    exampleJobTemplate(useTypeScript)
  )

  // Tooling
  write(dir, '.prettierrc', prettierrcTemplate())
  write(dir, '.prettierignore', prettierignoreTemplate())
  write(dir, '.env', envTemplate())
  write(dir, '.gitignore', gitignoreTemplate())
  write(dir, 'README.md', readmeTemplate(name))

  if (useEslint) {
    write(dir, 'eslint.config.mjs', eslintTemplate(useTypeScript))
  }

  write(dir, path.join('.agents', 'rules', 'AGENTS.md'), agentsTemplate())
}

function write(dir: string, file: string, content: string): void {
  const fullPath = path.resolve(dir, file)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content, 'utf8')
}
