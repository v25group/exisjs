/**
 * HTTP benchmark: ExisJS against node:http, Fastify, Hono and Express.
 *
 *   npm run bench                         # full run, all targets & scenarios
 *   npm run bench -- --quick              # 1 round, short durations (smoke)
 *   npm run bench -- --targets exis-node,fastify --scenarios json,validate
 *   npm run bench -- --write              # also regenerate docs/BENCHMARKS.md
 *
 * Options: --rounds N  --duration S  --warmup S  --connections N
 *          --pipelining N  --workers N  --targets ids  --scenarios ids
 *
 * Methodology (see bench/README.md): one server process per target, response
 * correctness verified first, warmup before every measured run, targets
 * interleaved in random order across rounds, medians reported. Besides
 * req/s, the server's own CPU time per request is recorded; it is far less
 * sensitive to load-generator and OS noise than throughput.
 */
import autocannon from 'autocannon'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ROOT_DIR,
  BENCH_DIR,
  assertFreshBuild,
  median,
  parseArgs,
  pickTargets,
  shuffle,
  sleep,
  startServer,
  type Target,
} from './lib/harness'
import { pickScenarios, verify, type Scenario } from './lib/scenarios'

const args = parseArgs(process.argv.slice(2))
const quick = args.quick === true
const num = (key: string, fallback: number) =>
  typeof args[key] === 'string' ? Number(args[key]) : fallback

const config = {
  rounds: num('rounds', quick ? 1 : 3),
  duration: num('duration', quick ? 3 : 10),
  warmup: num('warmup', quick ? 1 : 3),
  connections: num('connections', 100),
  pipelining: num('pipelining', 1),
  workers: num('workers', 0),
}

const targets = pickTargets(args.targets)
const scenarios = pickScenarios(args.scenarios)

interface Sample {
  rps: number
  p50: number
  p99: number
  cpuPerReq: number // µs of server CPU per completed request
  rss: number // bytes, after the run
  errors: number
  clientCpu: number // load generator CPU, fraction of one core
}

function load(port: number, s: Scenario, duration: number) {
  return autocannon({
    url: `http://127.0.0.1:${port}${s.path}`,
    method: s.method,
    body: s.body,
    headers: s.body ? { 'content-type': 'application/json' } : undefined,
    connections: config.connections,
    pipelining: config.pipelining,
    duration,
    ...(config.workers > 0 ? { workers: config.workers } : {}),
  })
}

async function measureTarget(
  target: Target,
  port: number
): Promise<Map<string, Sample>> {
  const server = await startServer(target, port)
  const out = new Map<string, Sample>()
  try {
    for (const s of scenarios) await verify(port, s)

    for (const s of scenarios) {
      await load(port, s, config.warmup)
      const before = await server.usage()
      const clientBefore = process.cpuUsage()
      const wallStart = process.hrtime.bigint()
      const r = await load(port, s, config.duration)
      const wallUs = Number(process.hrtime.bigint() - wallStart) / 1000
      const client = process.cpuUsage(clientBefore)
      const after = await server.usage()

      const total = r.requests.total
      out.set(s.id, {
        rps: total / r.duration,
        p50: r.latency.p50,
        p99: r.latency.p99,
        cpuPerReq: total > 0 ? (after.cpu - before.cpu) / total : NaN,
        rss: after.rss,
        errors: r.errors + r.timeouts + r.non2xx,
        clientCpu: (client.user + client.system) / wallUs,
      })
    }
  } finally {
    await server.stop()
  }
  return out
}

function installedVersion(pkg: string): string {
  try {
    return JSON.parse(
      fs.readFileSync(
        path.join(ROOT_DIR, 'node_modules', pkg, 'package.json'),
        'utf8'
      )
    ).version
  } catch {
    return 'n/a'
  }
}

function environment() {
  const cpus = os.cpus()
  return {
    date: new Date().toISOString(),
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    cpu: `${cpus[0]?.model.trim() ?? 'unknown'} (${cpus.length} logical cores)`,
    ram: `${Math.round(os.totalmem() / 1024 ** 3)} GB`,
    node: process.version,
    versions: {
      exisjs: installedVersion('exisjs'),
      fastify: installedVersion('fastify'),
      hono: installedVersion('hono'),
      '@hono/node-server': installedVersion('@hono/node-server'),
      express: installedVersion('express'),
      autocannon: installedVersion('autocannon'),
    },
    config,
  }
}

const fmt = (n: number, d = 0) =>
  Number.isFinite(n)
    ? n.toLocaleString('en-US', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      })
    : 'n/a'

interface Row {
  target: Target
  rps: number
  p50: number
  p99: number
  cpuPerReq: number
  rssMb: number
  errors: number
  clientCpu: number
}

function aggregate(samples: Sample[], target: Target): Row {
  return {
    target,
    rps: median(samples.map((x) => x.rps)),
    p50: median(samples.map((x) => x.p50)),
    p99: median(samples.map((x) => x.p99)),
    cpuPerReq: median(samples.map((x) => x.cpuPerReq)),
    rssMb: median(samples.map((x) => x.rss)) / 1024 / 1024,
    errors: samples.reduce((a, x) => a + x.errors, 0),
    clientCpu: Math.max(...samples.map((x) => x.clientCpu)),
  }
}

function table(rows: Row[]): string {
  const baseline = rows.find((r) => r.target.id === 'raw-node')
  const lines = [
    '| Target | Req/s | vs node:http | p50 (ms) | p99 (ms) | Server CPU / req (µs) | RSS (MB) | Errors |',
    '| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ]
  for (const r of [...rows].sort((a, b) => b.rps - a.rps)) {
    const rel = baseline ? `${fmt((r.rps / baseline.rps) * 100)}%` : '–'
    lines.push(
      `| ${r.target.name} | ${fmt(r.rps)} | ${rel} | ${fmt(r.p50, 1)} | ${fmt(r.p99, 1)} | ${fmt(r.cpuPerReq, 1)} | ${fmt(r.rssMb)} | ${r.errors} |`
    )
  }
  return lines.join('\n')
}

function markdown(
  env: ReturnType<typeof environment>,
  results: Map<string, Row[]>
): string {
  const v = env.versions
  let md = `# Benchmarks\n\n`
  md += `> Generated by \`npm run bench -- --write\` on ${env.date.slice(0, 10)}. `
  md += `Methodology and how to reproduce: [bench/README.md](../bench/README.md).\n\n`
  md += `## Environment\n\n`
  md += `| | |\n| :--- | :--- |\n`
  md += `| OS | ${env.os} |\n| CPU | ${env.cpu} |\n| RAM | ${env.ram} |\n| Node.js | ${env.node} |\n`
  md += `| Versions | exisjs ${v.exisjs}, fastify ${v.fastify}, hono ${v.hono} (@hono/node-server ${v['@hono/node-server']}), express ${v.express} |\n`
  md += `| Load | autocannon ${v.autocannon}, ${env.config.connections} connections, pipelining ${env.config.pipelining}, ${env.config.duration}s per run after ${env.config.warmup}s warmup |\n`
  md += `| Rounds | ${env.config.rounds}, targets in random order each round, medians reported |\n\n`
  md += `Load generator and servers share one machine; every server runs single-process (no clustering).\n\n`

  for (const s of scenarios) {
    const rows = results.get(s.id)
    if (!rows) continue
    md += `## ${s.title}\n\n${table(rows)}\n\n`
  }

  md += `## Reading these numbers\n\n`
  md += `- **Server CPU / req** is the most reliable column for comparing frameworks: it counts only CPU the server process spent, so load-generator contention and OS scheduling noise affect it far less than req/s.\n`
  md += `- **vs node:http** compares with a hand-rolled \`node:http\` server, the practical ceiling for anything built on Node's HTTP stack. \`ExisJS (uws)\` uses uWebSockets.js and is not bound by that ceiling.\n`
  md += `- POST /users validation differs by framework: ${targets.map((t) => `${t.name}: ${t.validation}`).join('; ')}.\n`
  md += `- ExisJS responses carry an \`X-Request-Id\` header that the other frameworks do not add.\n`
  md += `- Laptop and desktop results vary by ±10–20% between runs. Compare numbers from the same run, and use isolated Linux machines (load generator on a separate host) for publishable figures.\n`
  return md
}

async function main() {
  assertFreshBuild()
  const env = environment()
  console.log(
    `Targets: ${targets.map((t) => t.id).join(', ')}\nScenarios: ${scenarios.map((s) => s.id).join(', ')}\n` +
      `Config: ${JSON.stringify(config)}\n`
  )

  const samples = new Map<string, Map<string, Sample[]>>() // target -> scenario -> samples
  for (let round = 1; round <= config.rounds; round++) {
    for (const target of shuffle(targets)) {
      const port = 4100 + Math.floor(Math.random() * 800)
      process.stdout.write(
        `round ${round}/${config.rounds}  ${target.id.padEnd(10)} `
      )
      const res = await measureTarget(target, port)
      const perTarget = samples.get(target.id) ?? new Map()
      for (const [sid, sample] of res) {
        perTarget.set(sid, [...(perTarget.get(sid) ?? []), sample])
      }
      samples.set(target.id, perTarget)
      console.log(
        [...res]
          .map(([sid, x]) => `${sid}=${fmt(x.rps)}/s ${fmt(x.cpuPerReq, 1)}µs`)
          .join('  ')
      )
      await sleep(1000) // let ports and CPU settle
    }
  }

  const results = new Map<string, Row[]>()
  let clientBound = false
  for (const s of scenarios) {
    const rows = targets
      .map((t) => {
        const list = samples.get(t.id)?.get(s.id)
        return list?.length ? aggregate(list, t) : null
      })
      .filter((r): r is Row => r !== null)
    results.set(s.id, rows)
    // process CPU covers all autocannon worker threads; compare per thread
    const threads = Math.max(1, config.workers)
    if (rows.some((r) => r.clientCpu / threads > 0.9)) clientBound = true
    console.log(`\n### ${s.title}\n\n${table(rows)}`)
  }

  if (clientBound) {
    console.warn(
      '\n⚠ The load generator used >90% of a CPU core in some runs, so req/s there may be limited by the client, not the server. Server CPU / req is unaffected. For client-independent req/s, run the load generator on another machine, or try --workers N on hosts with spare cores.'
    )
  }

  const outDir = path.join(BENCH_DIR, 'results')
  fs.mkdirSync(outDir, { recursive: true })
  const stamp = env.date.replace(/[:.]/g, '-')
  const jsonPath = path.join(outDir, `${stamp}.json`)
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        env,
        results: Object.fromEntries(
          [...results].map(([sid, rows]) => [
            sid,
            rows.map(({ target, ...r }) => ({ target: target.id, ...r })),
          ])
        ),
      },
      null,
      2
    )
  )
  console.log(`\nRaw results: ${path.relative(ROOT_DIR, jsonPath)}`)

  if (args.write === true) {
    const mdPath = path.join(ROOT_DIR, 'docs', 'BENCHMARKS.md')
    fs.writeFileSync(mdPath, markdown(env, results))
    console.log(`Updated ${path.relative(ROOT_DIR, mdPath)}`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
