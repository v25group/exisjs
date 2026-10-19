// Production install budget for the exisjs runtime (docs/REPORT.md B8).
//
//   node scripts/size-budget.mjs           check against size-budget.json
//   node scripts/size-budget.mjs --update  record the current numbers (+10%)
//
// Packs packages/exisjs and packages/cli, installs exisjs into an empty
// project the way a production image does (npm install --omit=dev
// --omit=optional), and measures node_modules. Fails when the size or the
// package count exceeds the budget, or when build tooling is installed.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUDGET_FILE = path.join(ROOT, 'size-budget.json')
const FORBIDDEN = [
  'typescript',
  'esbuild',
  'tsx',
  'chokidar',
  'commander',
  'pino-pretty',
]
const update = process.argv.includes('--update')

// One command string: npm is npm.cmd on Windows, which needs a shell
const quote = (arg) => (/^[\w./:=@-]+$/.test(arg) ? arg : `"${arg}"`)
const npm = (args, cwd) =>
  execSync(`npm ${args.map(quote).join(' ')}`, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'exis-size-'))
try {
  const pack = (dir) =>
    path.join(
      work,
      JSON.parse(npm(['pack', '--json', '--pack-destination', work], dir))[0]
        .filename
    )
  const runtime = pack(path.join(ROOT, 'packages', 'exisjs'))
  const cli = pack(path.join(ROOT, 'packages', 'cli'))

  const app = path.join(work, 'app')
  fs.mkdirSync(app)
  fs.writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify({
      name: 'size-budget-app',
      private: true,
      dependencies: { exisjs: `file:${runtime}` },
      // The optional @exisjs/cli is skipped, but must resolve to this build
      overrides: { '@exisjs/cli': `file:${cli}` },
    })
  )
  npm(
    [
      'install',
      '--omit=dev',
      '--omit=optional',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    app
  )

  const modules = path.join(app, 'node_modules')
  let bytes = 0
  const packages = new Set()
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) walk(p)
      else bytes += fs.statSync(p).size
    }
  }
  const collect = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.')) continue
      const p = path.join(dir, name)
      if (name.startsWith('@')) {
        for (const sub of fs.readdirSync(p))
          visit(path.join(p, sub), `${name}/${sub}`)
      } else visit(p, name)
    }
  }
  const visit = (dir, name) => {
    if (!fs.existsSync(path.join(dir, 'package.json'))) return
    packages.add(name)
    collect(path.join(dir, 'node_modules'))
  }
  walk(modules)
  collect(modules)

  const found = FORBIDDEN.filter((name) => packages.has(name))
  const mb = (n) => (n / 1024 / 1024).toFixed(2)
  console.log(
    `Production install of exisjs: ${mb(bytes)} MB, ${packages.size} packages`
  )

  if (found.length > 0) {
    console.error(
      `✗ Build tooling in the production install: ${found.join(', ')}`
    )
    process.exit(1)
  }

  if (update) {
    const budget = {
      maxBytes: Math.ceil(bytes * 1.1),
      maxPackages: Math.ceil(packages.size * 1.1),
      measured: {
        bytes,
        packages: packages.size,
        date: new Date().toISOString().slice(0, 10),
      },
    }
    fs.writeFileSync(BUDGET_FILE, JSON.stringify(budget, null, 2) + '\n')
    console.log(
      `Budget written: ${mb(budget.maxBytes)} MB, ${budget.maxPackages} packages`
    )
  } else {
    const budget = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'))
    const problems = []
    if (bytes > budget.maxBytes)
      problems.push(`size ${mb(bytes)} MB > budget ${mb(budget.maxBytes)} MB`)
    if (packages.size > budget.maxPackages)
      problems.push(`${packages.size} packages > budget ${budget.maxPackages}`)
    if (problems.length > 0) {
      console.error(`✗ Over budget: ${problems.join('; ')}`)
      console.error(
        '  Remove the new dependency, or raise the budget on purpose: node scripts/size-budget.mjs --update'
      )
      process.exit(1)
    }
    console.log(
      `✓ Within budget (${mb(budget.maxBytes)} MB, ${budget.maxPackages} packages)`
    )
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}
