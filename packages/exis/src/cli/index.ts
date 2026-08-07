#!/usr/bin/env node

import { Command } from 'commander'
import { banner, c } from './utils'
import { devCommand } from './commands/dev'
import { buildCommand } from './commands/build'
import { startCommand } from './commands/start'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../../package.json')

const program = new Command()

program
  .name('exis')
  .description('The Exis JS CLI')
  .version(pkg.version, '-v, --version', 'Output the current version')

// ─── dev ─────────────────────────────────────────────────────────────────────

program
  .command('dev')
  .description('Start the development server with hot reload')
  .option('-p, --port <port>', 'Port to listen on')
  .option('-h, --host <host>', 'Host to bind to')
  .option('-e, --entry <file>', 'Custom entry file path')
  .action(async (options) => {
    await devCommand(options)
  })

// ─── build ────────────────────────────────────────────────────────────────────

program
  .command('build')
  .description('Compile TypeScript to production JavaScript')
  .option('-o, --out-dir <dir>', 'Output directory (default: dist)')
  .option('--no-clean', 'Skip cleaning the output directory')
  .action(async (options) => {
    await buildCommand(options)
  })

// ─── start ────────────────────────────────────────────────────────────────────

program
  .command('start')
  .description('Start the production server')
  .option('-p, --port <port>', 'Port to listen on')
  .option('-h, --host <host>', 'Host to bind to')
  .option('-e, --entry <file>', 'Custom entry file path')
  .action(async (options) => {
    await startCommand(options)
  })

// ─── routes ───────────────────────────────────────────────────────────────────

program
  .command('routes')
  .description('Print the application routing table')
  .option('-e, --entry <file>', 'Custom entry file path')
  .action(async (options) => {
    const { routesCommand } = await import('./routes')
    await routesCommand(process.cwd(), options.entry)
  })

// ─── init ─────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialize a new Exis JS project in the current directory')
  .action(async () => {
    const { initCommand } = await import('./commands/init')
    await initCommand()
  })

// ─── exports ──────────────────────────────────────────────────────────────────

program
  .command('exports')
  .description('List all available framework exports')
  .action(async () => {
    const { exportsCommand } = await import('./commands/exports')
    await exportsCommand()
  })

// ─── console ──────────────────────────────────────────────────────────────────

program
  .command('console')
  .alias('repl')
  .description('Start the interactive REPL console')
  .option('-e, --entry <file>', 'Custom entry file path')
  .action(async (options) => {
    const { replCommand } = await import('./commands/repl')
    await replCommand(options)
  })

// ─── test ─────────────────────────────────────────────────────────────────────

program
  .command('test [files...]')
  .description('Run the native test suite (node:test)')
  .option('--watch', 'Watch for file changes and re-run tests')
  .option('-u, --update', 'Update test snapshots')
  .option('-e, --entry <file>', 'Custom entry file path')
  .action(async (files, options) => {
    const { testCommand } = await import('./commands/test')
    await testCommand({ ...options, files })
  })

// ─── info ─────────────────────────────────────────────────────────────────────

program
  .command('info')
  .description('Show environment and version information')
  .action(() => {
    banner()
    console.log(
      `${c.gray}  Version:  ${c.reset}${c.cyan}${pkg.version}${c.reset}`
    )
    console.log(
      `${c.gray}  Node.js:  ${c.reset}${c.cyan}${process.version}${c.reset}`
    )
    console.log(
      `${c.gray}  Platform: ${c.reset}${c.cyan}${process.platform}${c.reset}`
    )
    console.log(
      `${c.gray}  Arch:     ${c.reset}${c.cyan}${process.arch}${c.reset}`
    )
    console.log()
  })

// ─── Default: show banner on bare `exis` ──────────────────────────────────────

if (process.argv.length === 2) {
  banner()
  console.log(`${c.gray}  Usage:${c.reset}`)
  console.log(`    ${c.cyan}exis dev${c.reset}              Start dev server`)
  console.log(
    `    ${c.cyan}exis build${c.reset}            Build for production`
  )
  console.log(
    `    ${c.cyan}exis start${c.reset}            Start production server`
  )
  console.log(`    ${c.cyan}exis test${c.reset}             Run test suite`)
  console.log(
    `    ${c.cyan}exis info${c.reset}             Show environment info`
  )
  console.log(
    `    ${c.cyan}exis init${c.reset}             Initialize a project in current directory`
  )
  console.log(
    `    ${c.cyan}exis exports${c.reset}          List all available framework exports`
  )
  console.log(
    `    ${c.cyan}exis generate <type>${c.reset}  Scaffold a new feature`
  )
  console.log()
  process.exit(0)
}

// ─── generate ─────────────────────────────────────────────────────────────────

program
  .command('generate')
  .alias('g')
  .description('Generate new features')
  .argument(
    '<type>',
    'Type of feature to generate (route | resource | plugin | middleware | test)'
  )
  .argument('[name]', 'Name of the feature')
  .option(
    '--oop',
    'Generate using Class-Based (OOP) paradigm instead of Functional'
  )
  .action(async (type, name, options) => {
    const { generateRoute, generatePlugin, generateMiddleware, generateTest } =
      await import('./commands/generate')
    if (type === 'route' || type === 'r' || type === 'resource') {
      if (!name) return console.error('Name is required for route/resource')
      await generateRoute(name, process.cwd(), options)
    } else if (type === 'plugin' || type === 'p') {
      if (!name) return console.error('Name is required for plugin')
      await generatePlugin(name)
    } else if (type === 'middleware' || type === 'm') {
      if (!name) return console.error('Name is required for middleware')
      await generateMiddleware(name)
    } else if (type === 'test' || type === 't') {
      if (!name) return console.error('Name is required for test')
      await generateTest(name)
    } else {
      console.error(
        'Unknown generator type. Supported types: route, plugin, middleware, test'
      )
    }
  })

program.parse(process.argv)
