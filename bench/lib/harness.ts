import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const BENCH_DIR = path.resolve(__dirname, '..')
export const ROOT_DIR = path.resolve(BENCH_DIR, '..')

export interface Target {
  /** Short id used on the command line, e.g. `exis-node` */
  id: string
  /** Display name in reports */
  name: string
  file: string
  env?: Record<string, string>
  /** How POST /users is validated, shown in reports for transparency */
  validation: string
}

export const TARGETS: Target[] = [
  {
    id: 'raw-node',
    name: 'node:http (baseline)',
    file: 'raw-node.js',
    validation: 'hand-written',
  },
  {
    id: 'exis-node',
    name: 'ExisJS (node)',
    file: 'exis.js',
    env: { BACKEND: 'node' },
    validation: 'tex schema',
  },
  {
    id: 'exis-uws',
    name: 'ExisJS (uws)',
    file: 'exis.js',
    env: { BACKEND: 'uws' },
    validation: 'tex schema',
  },
  {
    id: 'fastify',
    name: 'Fastify',
    file: 'fastify.js',
    validation: 'JSON schema (Ajv)',
  },
  { id: 'hono', name: 'Hono', file: 'hono.js', validation: 'hand-written' },
  {
    id: 'express',
    name: 'Express',
    file: 'express.js',
    validation: 'hand-written',
  },
]

export interface Usage {
  cpu: number // cumulative user+system CPU in µs
  rss: number // bytes
}

export interface RunningServer {
  target: Target
  port: number
  backend: string
  child: ChildProcess
  usage(): Promise<Usage>
  stop(): Promise<void>
}

/**
 * Starts a benchmark server in its own process. Extra `nodeArgs` (for
 * example `--cpu-prof`) are passed to Node.
 */
export function startServer(
  target: Target,
  port: number,
  nodeArgs: string[] = []
): Promise<RunningServer> {
  const child = spawn(
    process.execPath,
    [...nodeArgs, path.join(BENCH_DIR, 'servers', target.file)],
    {
      cwd: ROOT_DIR,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: {
        ...process.env,
        ...target.env,
        PORT: String(port),
        NODE_ENV: 'production',
      },
    }
  )

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${target.id} did not start within 20s`))
    }, 20_000)

    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`${target.id} exited during startup (code ${code})`))
    })

    child.on('message', function onReady(msg: any) {
      if (msg?.type !== 'ready') return
      clearTimeout(timer)
      child.off('message', onReady)
      child.removeAllListeners('exit')
      resolve({
        target,
        port,
        backend: msg.backend,
        child,
        usage: () =>
          new Promise((res) => {
            child.on('message', function onUsage(m: any) {
              if (m?.type !== 'usage') return
              child.off('message', onUsage)
              res({ cpu: m.cpu, rss: m.rss })
            })
            child.send('usage')
          }),
        stop: () =>
          new Promise((res) => {
            if (child.exitCode !== null) return res()
            const kill = setTimeout(() => child.kill('SIGKILL'), 5000)
            child.once('exit', () => {
              clearTimeout(kill)
              res()
            })
            child.send('exit')
          }),
      })
    })
  })
}

/**
 * Benchmarks must run against the compiled package, the same code users
 * install. Fail fast when dist is missing or older than the sources.
 */
export function assertFreshBuild(): void {
  const pkg = path.join(ROOT_DIR, 'packages', 'exisjs')
  const distEntry = path.join(pkg, 'dist', 'index.js')
  if (!fs.existsSync(distEntry)) {
    throw new Error(
      'packages/exisjs/dist is missing. Run `npm run build` before benchmarking.'
    )
  }
  const distTime = fs.statSync(distEntry).mtimeMs
  const newestSrc = newestMtime(path.join(pkg, 'src'))
  if (newestSrc > distTime) {
    throw new Error(
      'packages/exisjs/src is newer than dist. Run `npm run build` so the benchmark measures your latest code.'
    )
  }
}

function newestMtime(dir: string): number {
  let newest = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    newest = Math.max(
      newest,
      entry.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs
    )
  }
  return newest
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function median(values: number[]): number {
  if (values.length === 0) return NaN
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Minimal `--key value` / `--flag` parser */
export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else {
      out[key] = next
      i++
    }
  }
  return out
}

export function pickTargets(spec: string | true | undefined): Target[] {
  if (typeof spec !== 'string') return TARGETS
  const ids = spec.split(',').map((s) => s.trim())
  const unknown = ids.filter((id) => !TARGETS.some((t) => t.id === id))
  if (unknown.length) {
    throw new Error(
      `Unknown target(s): ${unknown.join(', ')}. Known: ${TARGETS.map((t) => t.id).join(', ')}`
    )
  }
  return TARGETS.filter((t) => ids.includes(t.id))
}
