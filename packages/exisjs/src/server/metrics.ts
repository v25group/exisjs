// Prometheus metrics for `metrics: { enabled: true }`.
//
// Requests are labelled by route pattern (`/users/:id`), never the raw URL,
// so the number of series stays bounded. In cluster mode every worker keeps
// its own numbers; a scrape that reaches any worker asks the primary to
// collect all of them, so counters never jump between workers.

import cluster from 'node:cluster'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { Handler } from '../types'

/** Seconds; the usual Prometheus client defaults */
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
const UNMATCHED = '(unmatched)'
const SEP = '\u0000'

interface Histogram {
  buckets: number[] // per bucket, not cumulative
  sum: number
  count: number
}

/** One process's numbers, sent over IPC in cluster mode */
export interface MetricsSnapshot {
  worker?: number
  requests: Record<string, number> // method SEP route SEP status
  durations: Record<string, Histogram> // method SEP route
  inFlight: number
  rss: number
  heapUsed: number
  eventLoopLagP99: number // seconds
  startTime: number // seconds since epoch
}

export class MetricsRegistry {
  private requests = new Map<string, number>()
  private durations = new Map<string, Histogram>()
  private inFlight = 0
  private readonly lag = monitorEventLoopDelay({ resolution: 20 })
  private readonly startTime = Date.now() / 1000

  constructor() {
    this.lag.enable()
  }

  /** Global middleware: counts every request, matched or not */
  middleware(): Handler {
    return (req, res, next) => {
      const start = process.hrtime.bigint()
      this.inFlight++
      // 'close' fires for finished, streamed and aborted responses alike
      res.raw.once('close', () => {
        this.inFlight--
        const route = (req as any).routePath ?? UNMATCHED
        // 499: the client closed the connection before the response finished
        const status = res.raw.writableFinished ? res.raw.statusCode : 499
        const seconds = Number(process.hrtime.bigint() - start) / 1e9
        this.observe(req.method, route, status, seconds)
      })
      next?.()
    }
  }

  observe(
    method: string,
    route: string,
    status: number,
    seconds: number
  ): void {
    const key = method + SEP + route
    const countKey = key + SEP + status
    this.requests.set(countKey, (this.requests.get(countKey) ?? 0) + 1)
    let h = this.durations.get(key)
    if (!h) {
      h = { buckets: new Array(BUCKETS.length).fill(0), sum: 0, count: 0 }
      this.durations.set(key, h)
    }
    h.sum += seconds
    h.count++
    const i = BUCKETS.findIndex((b) => seconds <= b)
    if (i !== -1) h.buckets[i]++
  }

  snapshot(): MetricsSnapshot {
    const mem = process.memoryUsage()
    return {
      worker: cluster.worker?.id,
      requests: Object.fromEntries(this.requests),
      durations: Object.fromEntries(this.durations),
      inFlight: this.inFlight,
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      eventLoopLagP99: this.lag.percentile(99) / 1e9,
      startTime: this.startTime,
    }
  }

  /** This process's numbers, or every worker's in cluster mode */
  async collect(): Promise<MetricsSnapshot[]> {
    if (!cluster.isWorker || !process.send) return [this.snapshot()]
    try {
      return await requestFromPrimary()
    } catch {
      return [this.snapshot()] // primary did not answer: still serve something
    }
  }

  stop(): void {
    this.lag.disable()
  }
}

// ─── Cluster ─────────────────────────────────────────────────────────────────

let nextRequest = 0
const pending = new Map<number, (s: MetricsSnapshot[]) => void>()
let workerListener = false

/** In a worker: answer the primary's snapshot requests and its replies */
export function listenAsWorker(registry: MetricsRegistry): void {
  if (!cluster.isWorker || workerListener) return
  workerListener = true
  process.on('message', (msg: any) => {
    if (msg?.type === 'exis:metrics:snapshot') {
      process.send?.({
        type: 'exis:metrics:snapshot-reply',
        id: msg.id,
        snapshot: registry.snapshot(),
      })
    } else if (msg?.type === 'exis:metrics:result') {
      pending.get(msg.id)?.(msg.snapshots)
      pending.delete(msg.id)
    }
  })
}

function requestFromPrimary(): Promise<MetricsSnapshot[]> {
  return new Promise((resolve, reject) => {
    const id = nextRequest++
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('metrics: no answer from the cluster primary'))
    }, 2000)
    timer.unref()
    pending.set(id, (snapshots) => {
      clearTimeout(timer)
      resolve(snapshots)
    })
    process.send!({ type: 'exis:metrics:collect', id })
  })
}

/**
 * In the primary: when a worker asks, collect a snapshot from every live
 * worker (waiting at most 1 s) and send them all back to it.
 */
export function handlePrimaryMessage(
  from: import('node:cluster').Worker,
  msg: any
): boolean {
  if (msg?.type !== 'exis:metrics:collect') return false
  const workers = Object.values(cluster.workers ?? {}).filter(
    (w): w is import('node:cluster').Worker => !!w && w.isConnected()
  )
  const snapshots: MetricsSnapshot[] = []
  const collectId = `${from.id}:${msg.id}`
  const listeners = new Map<import('node:cluster').Worker, (m: any) => void>()
  let done = false
  const reply = () => {
    if (done) return
    done = true
    clearTimeout(timer)
    // A worker that never answered must not keep a listener per scrape
    for (const [w, fn] of listeners) w.off('message', fn)
    if (from.isConnected()) {
      from.send({ type: 'exis:metrics:result', id: msg.id, snapshots })
    }
  }
  const timer = setTimeout(reply, 1000)
  timer.unref()
  for (const w of workers) {
    const onReply = (m: any) => {
      if (m?.type !== 'exis:metrics:snapshot-reply' || m.id !== collectId)
        return
      snapshots.push(m.snapshot)
      if (snapshots.length === workers.length) reply()
    }
    listeners.set(w, onReply)
    w.on('message', onReply)
    w.send({ type: 'exis:metrics:snapshot', id: collectId })
  }
  if (workers.length === 0) reply()
  return true
}

// ─── Prometheus text format ──────────────────────────────────────────────────

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

function labels(pairs: Record<string, string | number | undefined>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(pairs)) {
    if (v !== undefined) parts.push(`${k}="${escapeLabel(String(v))}"`)
  }
  return parts.length > 0 ? `{${parts.join(',')}}` : ''
}

/** Prometheus text exposition (version 0.0.4); request series are summed across workers */
export function render(snapshots: MetricsSnapshot[]): string {
  const requests = new Map<string, number>()
  const durations = new Map<string, Histogram>()
  let inFlight = 0
  for (const s of snapshots) {
    inFlight += s.inFlight
    for (const [k, v] of Object.entries(s.requests)) {
      requests.set(k, (requests.get(k) ?? 0) + v)
    }
    for (const [k, h] of Object.entries(s.durations)) {
      const total = durations.get(k)
      if (!total) {
        durations.set(k, {
          buckets: [...h.buckets],
          sum: h.sum,
          count: h.count,
        })
      } else {
        h.buckets.forEach((n, i) => (total.buckets[i] += n))
        total.sum += h.sum
        total.count += h.count
      }
    }
  }

  const out: string[] = []
  out.push(
    '# HELP http_requests_total Requests answered, by route pattern, method and status.',
    '# TYPE http_requests_total counter'
  )
  for (const [key, n] of [...requests].sort()) {
    const [method, route, status] = key.split(SEP)
    out.push(`http_requests_total${labels({ method, route, status })} ${n}`)
  }

  out.push(
    '# HELP http_request_duration_seconds Time to answer a request, by route pattern and method.',
    '# TYPE http_request_duration_seconds histogram'
  )
  for (const [key, h] of [...durations].sort()) {
    const [method, route] = key.split(SEP)
    let cumulative = 0
    BUCKETS.forEach((le, i) => {
      cumulative += h.buckets[i]
      out.push(
        `http_request_duration_seconds_bucket${labels({ method, route, le })} ${cumulative}`
      )
    })
    out.push(
      `http_request_duration_seconds_bucket${labels({ method, route, le: '+Inf' })} ${h.count}`,
      `http_request_duration_seconds_sum${labels({ method, route })} ${h.sum}`,
      `http_request_duration_seconds_count${labels({ method, route })} ${h.count}`
    )
  }

  out.push(
    '# HELP http_requests_in_flight Requests being handled now.',
    '# TYPE http_requests_in_flight gauge',
    `http_requests_in_flight ${inFlight}`
  )

  // Per process: summing memory or lag across workers would mean nothing
  const gauges: [string, string, (s: MetricsSnapshot) => number][] = [
    [
      'process_resident_memory_bytes',
      'Resident memory size in bytes.',
      (s) => s.rss,
    ],
    ['nodejs_heap_used_bytes', 'V8 heap in use, in bytes.', (s) => s.heapUsed],
    [
      'nodejs_eventloop_lag_p99_seconds',
      'Event-loop delay, 99th percentile since start, in seconds.',
      (s) => s.eventLoopLagP99,
    ],
    [
      'process_start_time_seconds',
      'Start time since the Unix epoch, in seconds.',
      (s) => s.startTime,
    ],
  ]
  for (const [name, help, value] of gauges) {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`)
    for (const s of snapshots) {
      out.push(`${name}${labels({ worker: s.worker })} ${value(s)}`)
    }
  }
  return out.join('\n') + '\n'
}
