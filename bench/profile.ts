/**
 * Profiles one server under load with V8's built-in profilers.
 *
 *   npm run bench:profile                                 # exis-node, all scenarios, CPU
 *   npm run bench:profile -- --target exis-uws --scenario validate
 *   npm run bench:profile -- --heap                       # allocation sampling instead
 *
 * Options: --target id  --scenario id  --duration S  --connections N  --top N
 *
 * Writes the raw profile to bench/.profiles/ and prints the hottest functions.
 * Open the .cpuprofile in Chrome DevTools (Performance > Load profile) or
 * https://www.speedscope.app for flame graphs; open .heapprofile in DevTools
 * (Memory tab).
 */
import autocannon from 'autocannon'
import fs from 'node:fs'
import path from 'node:path'
import {
  BENCH_DIR,
  ROOT_DIR,
  assertFreshBuild,
  parseArgs,
  pickTargets,
  startServer,
} from './lib/harness'
import { pickScenarios, verify } from './lib/scenarios'

const args = parseArgs(process.argv.slice(2))
const heap = args.heap === true
const target = pickTargets(
  typeof args.target === 'string' ? args.target : 'exis-node'
)[0]
const scenarios = pickScenarios(args.scenario)
const duration = typeof args.duration === 'string' ? Number(args.duration) : 10
const connections =
  typeof args.connections === 'string' ? Number(args.connections) : 100
const top = typeof args.top === 'string' ? Number(args.top) : 25

interface ProfileNode {
  id: number
  callFrame: { functionName: string; url: string; lineNumber: number }
  children?: number[]
  selfSize?: number
}

function label(cf: ProfileNode['callFrame']): string {
  const fn = cf.functionName || '(anonymous)'
  if (!cf.url) return fn
  const file = cf.url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/')
  const short = file.includes('/node_modules/')
    ? file.slice(file.lastIndexOf('/node_modules/') + 14)
    : file.includes('/packages/')
      ? file.slice(file.indexOf('/packages/') + 10)
      : file
  return `${fn}  ${short}:${cf.lineNumber + 1}`
}

function origin(cf: ProfileNode['callFrame']): string {
  const url = cf.url.replace(/\\/g, '/')
  if (!url) return 'native / V8'
  if (url.startsWith('node:')) return 'node core'
  if (url.includes('/packages/exisjs/')) return 'exisjs'
  if (url.includes('/node_modules/')) return 'dependencies'
  return 'other'
}

function bar(share: number): string {
  return `${(share * 100).toFixed(1).padStart(5)}%`
}

function summarizeCpu(file: string) {
  const prof = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    nodes: ProfileNode[]
    samples: number[]
    timeDeltas: number[]
  }
  const byId = new Map(prof.nodes.map((n) => [n.id, n]))
  const self = new Map<number, number>()
  prof.samples.forEach((id, i) =>
    self.set(id, (self.get(id) ?? 0) + (prof.timeDeltas[i] ?? 0))
  )

  const byFn = new Map<string, number>()
  const byOrigin = new Map<string, number>()
  let idle = 0
  let busy = 0
  for (const [id, t] of self) {
    const cf = byId.get(id)!.callFrame
    if (cf.functionName === '(idle)') {
      idle += t
      continue
    }
    busy += t
    byFn.set(label(cf), (byFn.get(label(cf)) ?? 0) + t)
    byOrigin.set(origin(cf), (byOrigin.get(origin(cf)) ?? 0) + t)
  }

  console.log(
    `\nCPU busy ${(busy / 1e6).toFixed(2)}s, idle ${(idle / 1e6).toFixed(2)}s (${((busy / (busy + idle)) * 100).toFixed(0)}% busy)`
  )
  console.log('\nBusy time by origin:')
  for (const [k, t] of [...byOrigin].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${bar(t / busy)}  ${k}`)
  }
  console.log(`\nTop ${top} functions by self time:`)
  for (const [k, t] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, top)) {
    console.log(`  ${bar(t / busy)}  ${k}`)
  }
  console.log(
    '\nTip: "native / V8" includes socket writes (writev) and GC; a high share there is normal for HTTP servers.'
  )
}

function summarizeHeap(file: string) {
  const prof = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    head: ProfileNode
  }
  const bySite = new Map<string, number>()
  let total = 0
  const walk = (n: ProfileNode) => {
    const size = n.selfSize ?? 0
    if (size > 0) {
      total += size
      bySite.set(
        label(n.callFrame),
        (bySite.get(label(n.callFrame)) ?? 0) + size
      )
    }
    for (const c of (n as any).children ?? []) walk(c)
  }
  walk(prof.head)
  console.log(
    `\nSampled live allocations at exit: ${(total / 1024 / 1024).toFixed(1)} MB`
  )
  console.log(`\nTop ${top} allocation sites:`)
  for (const [k, s] of [...bySite].sort((a, b) => b[1] - a[1]).slice(0, top)) {
    console.log(
      `  ${bar(s / total)}  ${(s / 1024).toFixed(0).padStart(7)} KB  ${k}`
    )
  }
}

async function main() {
  assertFreshBuild()
  const outDir = path.join(
    BENCH_DIR,
    '.profiles',
    `${target.id}-${new Date().toISOString().replace(/[:.]/g, '-')}`
  )
  fs.mkdirSync(outDir, { recursive: true })
  const flags = heap
    ? ['--heap-prof', `--heap-prof-dir=${outDir}`]
    : ['--cpu-prof', `--cpu-prof-dir=${outDir}`, '--cpu-prof-interval=250']

  const port = 4900 + Math.floor(Math.random() * 90)
  const server = await startServer(target, port, flags)
  try {
    for (const s of scenarios) await verify(port, s)
    for (const s of scenarios) {
      console.log(`Loading ${s.id} for ${duration}s ...`)
      await autocannon({
        url: `http://127.0.0.1:${port}${s.path}`,
        method: s.method,
        body: s.body,
        headers: s.body ? { 'content-type': 'application/json' } : undefined,
        connections,
        duration,
      })
    }
  } finally {
    await server.stop() // graceful exit so V8 writes the profile
  }

  const file = fs
    .readdirSync(outDir)
    .find((f) => f.endsWith(heap ? '.heapprofile' : '.cpuprofile'))
  if (!file) throw new Error(`No profile written to ${outDir}`)
  const full = path.join(outDir, file)
  console.log(`\nProfile: ${path.relative(ROOT_DIR, full)}`)
  if (heap) summarizeHeap(full)
  else summarizeCpu(full)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
