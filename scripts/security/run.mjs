// Builds nothing: starts a built example the production way, runs the attack
// suite against it, and stops it.
//
//   node scripts/security/run.mjs 06-secure-functional 4706 [uws|bun]
//
// For bun, BUN_PATH names the executable if `bun` isn't on PATH.
//
// Needs `npm run build`, `exisjs build` in the example, and MongoDB on localhost:27017.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const [name, port, engine] = process.argv.slice(2)
const cwd = path.join(ROOT, 'examples', name)

const runtime =
  engine === 'bun' ? (process.env.BUN_PATH ?? 'bun') : process.execPath
const server = spawn(runtime, ['.exis/server/main.js'], {
  cwd,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: port,
    INSECURE_COOKIES: '1',
    LOG_LEVEL: 'fatal',
    MONGODB_URI: `mongodb://localhost:27017/exis_attack_${name.replace(/\W/g, '_')}`,
    ...(engine ? { EXIS_SERVER: engine } : {}),
  },
})
let serverOutput = ''
server.stdout.on('data', (c) => (serverOutput += c))
server.stderr.on('data', (c) => (serverOutput += c))
let exited = null
server.on('exit', (code, signal) => (exited = code ?? signal))

const url = `http://127.0.0.1:${port}`
const deadline = Date.now() + 20000
let up = false
while (Date.now() < deadline && exited === null) {
  try {
    if ((await fetch(`${url}/health`)).status === 200) {
      up = true
      break
    }
  } catch {
    await new Promise((r) => setTimeout(r, 250))
  }
}
if (!up) {
  console.error(
    `Server did not start (exit ${exited}):\n${serverOutput.slice(-2000)}`
  )
  server.kill()
  process.exit(2)
}

// Asynchronous, so the server's exit and output are seen while it runs
const status = await new Promise((resolve) => {
  const attack = spawn(
    process.execPath,
    [path.join(ROOT, 'scripts', 'security', 'attack.mjs'), url],
    { stdio: 'inherit' }
  )
  attack.on('exit', (code) => resolve(code ?? 1))
})
if (exited !== null) {
  console.error(`
The server died during the attack (exit ${exited}):
${serverOutput.slice(-3000)}`)
}
server.kill()
process.exit(exited !== null ? 1 : status)
