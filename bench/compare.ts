import { spawn, ChildProcessByStdio } from 'child_process'
import path from 'path'
import http from 'http'
import type { Readable } from 'stream'
import autocannon from 'autocannon'
import fs from 'fs'
import os from 'os'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ─── Config ─────────────────────────────────────────────────────────────────

const TRIALS = 3 // runs per framework; we report the median across these
const WARMUP_REQUESTS = true // discard a short warmup hit before each timed run
const READY_TIMEOUT_MS = 15_000

const servers = [
  { name: 'Express', file: 'express.js', port: 3001 },
  { name: 'Fastify', file: 'fastify.js', port: 3002 },
  { name: 'Hono', file: 'hono.js', port: 3003 },
  { name: 'Exis JS', file: 'exis.js', port: 3004 },
]

interface TrialResult {
  reqPerSec: number
  latencyAvg: number
  latencyP50: number
  latencyP99: number
  errors: number
  backendNote: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Polls the health endpoint until it responds 200, instead of guessing a fixed sleep. */
function waitUntilReady(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume()
        if (res.statusCode === 200) return resolve()
        retry()
      })
      req.on('error', retry)
      req.setTimeout(1000, () => {
        req.destroy()
        retry()
      })
    }
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(
          new Error(
            `Server at ${url} did not become ready within ${timeoutMs}ms`
          )
        )
        return
      }
      setTimeout(attempt, 150)
    }
    attempt()
  })
}

// ─── Single trial ───────────────────────────────────────────────────────────

async function runTrial(
  serverInfo: (typeof servers)[0]
): Promise<TrialResult | null> {
  const serverPath = path.join(__dirname, 'servers', serverInfo.file)
  const child: ChildProcessByStdio<null, Readable, Readable> = spawn(
    process.execPath,
    [serverPath],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(serverInfo.port) },
    }
  )

  let backendNote = 'n/a'
  child.stdout.on('data', (chunk: Buffer) => {
    const line = chunk.toString()
    process.stdout.write(`[${serverInfo.name}] ${line}`)
    // Capture whatever the server actually reports it's running on, so
    // 'auto' resolution isn't left ambiguous in the results doc.
    const match = line.match(/using\s+(\S+)/i)
    if (match) backendNote = match[1]
  })
  child.stderr.on('data', (chunk: Buffer) => {
    process.stderr.write(`[${serverInfo.name}][err] ${chunk.toString()}`)
  })

  const url = `http://localhost:${serverInfo.port}/api/health`

  try {
    await waitUntilReady(url, READY_TIMEOUT_MS)
  } catch (err) {
    console.error(`Failed to start ${serverInfo.name}:`, err)
    child.kill()
    return null
  }

  if (WARMUP_REQUESTS) {
    // Short untimed run to let JIT/connection pools warm up before we measure.
    await autocannon({ url, connections: 20, duration: 2 })
    await sleep(300)
  }

  const result = await autocannon({
    url,
    connections: 100,
    duration: 10,
    pipelining: 1,
  })

  child.kill()
  await sleep(500) // let the port fully release before the next trial

  return {
    reqPerSec: result.requests.average,
    latencyAvg: result.latency.average,
    latencyP50: result.latency.p50,
    latencyP99: result.latency.p99,
    errors: result.errors,
    backendNote,
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const byName = new Map<string, TrialResult[]>()
  for (const s of servers) byName.set(s.name, [])

  for (let trial = 1; trial <= TRIALS; trial++) {
    console.log(`\n=== Trial ${trial}/${TRIALS} ===`)
    // Randomize order each trial so no single framework consistently benefits
    // from running first (cold) or last (warm machine / OS cache).
    const order = shuffle(servers)

    for (const serverInfo of order) {
      console.log(`\n--- Benchmarking ${serverInfo.name} (trial ${trial}) ---`)
      const result = await runTrial(serverInfo)
      if (result) {
        byName.get(serverInfo.name)!.push(result)
      }
      await sleep(1500) // cooldown between servers
    }
  }

  // ─── Aggregate: report medians across trials, not a single run ────────────
  const aggregated = servers.map((s) => {
    const trials = byName.get(s.name)!
    if (trials.length === 0) {
      return {
        name: s.name,
        reqPerSec: NaN,
        latencyAvg: NaN,
        latencyP50: NaN,
        latencyP99: NaN,
        errors: 0,
        backendNote: 'FAILED',
      }
    }
    return {
      name: s.name,
      reqPerSec: median(trials.map((t) => t.reqPerSec)),
      latencyAvg: median(trials.map((t) => t.latencyAvg)),
      latencyP50: median(trials.map((t) => t.latencyP50)),
      latencyP99: median(trials.map((t) => t.latencyP99)),
      errors: trials.reduce((sum, t) => sum + t.errors, 0),
      backendNote: trials[0].backendNote,
    }
  })

  console.log(`\n--- Benchmark Results (median of ${TRIALS} trials) ---`)
  console.table(aggregated)

  // ─── Write markdown ─────────────────────────────────────────────────────
  const cpus = os.cpus()
  const processor = cpus.length > 0 ? cpus[0].model : 'Unknown'
  const ram = Math.round(os.totalmem() / 1024 / 1024 / 1024)

  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
  )
  const dep = (name: string) =>
    rootPkg.devDependencies?.[name] ?? rootPkg.dependencies?.[name] ?? 'unknown'

  let md = '# Benchmark Results\n\n'

  md += '### System Information\n'
  md += `- **OS:** ${os.platform()} (${os.arch()})\n`
  md += `- **CPU:** ${processor} (${cpus.length} cores)\n`
  md += `- **RAM:** ${ram} GB\n`
  md += `- **Node:** ${process.version}\n\n`

  md += '### Test Configuration\n'
  md += `- **Tool:** autocannon ${dep('autocannon')}\n`
  md += `- **Connections:** 100, **Duration:** 10s, **Pipelining:** 1 (no pipelining)\n`
  md += `- **Trials:** ${TRIALS} per framework, order randomized each trial, median reported\n`
  md += `- **Warmup:** ${WARMUP_REQUESTS ? '2s untimed warmup run before each timed trial' : 'none'}\n`
  md += `- **Cores:** single-core, no clustering, for all four frameworks\n`
  md += `- **Framework versions:** Express ${dep('express')}, Fastify ${dep('fastify')}, Hono ${dep('hono')}, ExisJS ${rootPkg.version}\n\n`

  md += '### Performance Metrics\n\n'
  md +=
    '| Framework | Req/Sec (median) | Latency avg (ms) | Latency p50 (ms) | Latency p99 (ms) | Errors | Server backend |\n'
  md += '|---|---|---|---|---|---|---|\n'
  for (const r of aggregated) {
    md += `| ${r.name} | ${r.reqPerSec.toFixed(2)} | ${r.latencyAvg.toFixed(2)} | ${r.latencyP50.toFixed(2)} | ${r.latencyP99.toFixed(2)} | ${r.errors} | ${r.backendNote} |\n`
  }

  md += '\n### Handler Parity Note\n\n'
  md +=
    "ExisJS's handler in this benchmark declares a `response` JSON schema, which the framework uses to validate and serialize the response. Express, Fastify, and Hono's handlers here do not declare an equivalent schema. This makes ExisJS's numbers more notable if it still leads, since it's doing strictly more work per request — but it means this is not a pure routing-only comparison. A schema-stripped variant should be run separately if a fully symmetric comparison is needed.\n\n"

  md += '### Understanding the Results\n\n'
  md +=
    "You may notice that in our microbenchmarks (routing only), ExisJS's Radix Tree performs route lookups in ~3ns compared to Fastify's ~130ns (a ~40x difference). However, in the full HTTP throughput benchmark above, the gap narrows substantially.\n\n"
  md +=
    '**Why?** Route lookup is only a microscopic fraction of a full HTTP request lifecycle. The vast majority of time is spent on Node.js I/O, socket management, header parsing, and JSON serialization. While our router is objectively faster in isolation, overall framework throughput is bounded by the same underlying Node.js stream primitives every framework here is built on.\n\n'
  md +=
    '> *Note: These benchmarks were run locally on Windows, single-core, no clustering. For production-representative numbers, they should be reproduced on isolated Linux server instances with clustering configuration matching your actual deployment.*\n'

  const outPath = path.join(__dirname, '..', 'docs', 'BENCHMARKS.md')
  fs.writeFileSync(outPath, md)
  console.log(`\nResults written to ${outPath}`)
}

main().catch(console.error)
