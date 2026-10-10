// Verifies that what users start from actually works:
//   1. both example apps type-check, pass their tests, build, and answer
//      requests when started in production mode
//   2. a freshly scaffolded project (functional and class-based) type-checks,
//      passes its generated test and builds
//
//   npm run verify:examples
//
// Requires `npm run build` first. 02-bookstore needs MongoDB on
// localhost:27017 (set SKIP_MONGO=1 to skip it).
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXIS = path.join(ROOT, 'packages', 'exisjs', 'bin', 'exis.js')
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
const CREATE = path.join(ROOT, 'packages', 'create', 'bin', 'create-exis.js')
const JWT_SECRET = 'verify-examples-secret-0123456789abcdef'

let failed = false

function step(label, cwd, args, env = {}) {
  process.stdout.write(`  ${label} ... `)
  const res = spawnSync(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
  if (res.status === 0) {
    console.log('ok')
    return true
  }
  failed = true
  console.log('FAILED')
  console.log(
    `${res.stdout}\n${res.stderr}`
      .split('\n')
      .slice(-40)
      .map((l) => `      ${l}`)
      .join('\n')
  )
  return false
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(url)
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  return false
}

/** Starts the production build and checks each [method, path, status] */
async function smoke(cwd, port, env, checks) {
  process.stdout.write('  start (production) + requests ... ')
  let output = ''
  const child = spawn(process.execPath, [EXIS, 'start'], {
    cwd,
    env: { ...process.env, ...env, PORT: String(port) },
  })
  child.stdout.on('data', (d) => (output += d))
  child.stderr.on('data', (d) => (output += d))

  const base = `http://127.0.0.1:${port}`
  const problems = []
  if (!(await waitFor(base, 20_000))) {
    problems.push('server did not start')
  } else {
    for (const [method, route, expected, init] of checks) {
      const res = await fetch(base + route, { method, ...init })
      if (res.status !== expected) {
        problems.push(`${method} ${route}: expected ${expected}, got ${res.status}`)
      }
    }
  }
  child.kill()
  await new Promise((r) => child.once('exit', r))

  if (problems.length === 0) {
    console.log('ok')
    return
  }
  failed = true
  console.log('FAILED')
  for (const p of problems) console.log(`      ${p}`)
  console.log(output.split('\n').slice(-25).map((l) => `      ${l}`).join('\n'))
}

async function verifyExample(name, { env, checks, port }) {
  const cwd = path.join(ROOT, 'examples', name)
  console.log(`\n${name}`)
  step('type-check', cwd, [TSC, '--noEmit', '-p', '.'])
  step('tests', cwd, [EXIS, 'test'], env)
  if (step('build', cwd, [EXIS, 'build'], env)) {
    await smoke(cwd, port, env, checks)
  }
}

function verifyScaffold(paradigm) {
  const name = `zz-verify-${paradigm}`
  const cwd = path.join(ROOT, 'examples', name)
  console.log(`\ncreate-exisjs --${paradigm}`)
  fs.rmSync(cwd, { recursive: true, force: true })
  try {
    // Generated inside the workspace so it resolves the local exisjs build
    const ok = step('scaffold', path.join(ROOT, 'examples'), [
      CREATE,
      name,
      '-y',
      '--ts',
      `--${paradigm}`,
      '--no-eslint',
      '--skip-install',
      '--skip-git',
    ])
    if (!ok) return
    step('type-check', cwd, [TSC, '--noEmit', '-p', '.'])
    step('tests', cwd, [EXIS, 'test'])
    step('build', cwd, [EXIS, 'build'])
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
}

const json = (body) => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

await verifyExample('01-my-app', {
  port: 4701,
  env: { JWT_SECRET },
  checks: [
    ['GET', '/', 200],
    ['GET', '/health', 200],
    ['GET', '/docs/json', 200],
    // Protected by src/http/users/boundary.ts: must hold in production too
    ['GET', '/users', 401],
    ['POST', '/auth/register', 400, json({ email: 'not-an-email' })],
    [
      'POST',
      '/auth/register',
      201,
      json({ name: 'Ada', email: 'ada@example.com', password: 'correct-horse' }),
    ],
    ['GET', '/missing', 404],
  ],
})

if (process.env.SKIP_MONGO === '1') {
  console.log('\n02-bookstore\n  skipped (SKIP_MONGO=1)')
} else {
  await verifyExample('02-bookstore', {
    port: 4702,
    env: {
      JWT_SECRET,
      MONGODB_URI: 'mongodb://localhost:27017/bookstore_test',
    },
    checks: [
      ['GET', '/', 200],
      ['GET', '/health', 200],
      ['GET', '/api/books', 200],
      ['GET', '/api/auth/me', 401],
      // Authentication is checked before the body is validated
      ['POST', '/api/books', 401, json({})],
      ['GET', '/docs/json', 200],
    ],
  })
}

verifyScaffold('functional')
verifyScaffold('oop')

console.log(failed ? '\nverify:examples FAILED' : '\nverify:examples passed')
process.exit(failed ? 1 : 0)
