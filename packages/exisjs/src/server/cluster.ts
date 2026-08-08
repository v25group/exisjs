import cluster from 'node:cluster'
import os from 'node:os'
import process from 'node:process'

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ClusterConfig {
  /**
   * Number of worker processes to spawn.
   * - `'max'` = use all available CPU cores
   * - `'safe'` = cap at 4 cores for safety
   * - A specific number = spawn exactly that many workers
   * - `false` or `0` = disable clustering (single-process mode)
   *
   * @default 'safe'
   */
  workers?: number | boolean | 'safe' | 'max'

  /**
   * Whether to automatically respawn a worker if it crashes.
   * @default true
   */
  respawn?: boolean

  /**
   * Maximum number of respawns allowed within `respawnWindow` ms
   * before the cluster manager stops respawning (prevents crash loops).
   * @default 5
   */
  maxRespawns?: number

  /**
   * Time window (ms) in which `maxRespawns` is evaluated.
   * @default 60000 (1 minute)
   */
  respawnWindow?: number
}

// ─── Internals ──────────────────────────────────────────────────────────────────

const c = {
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
  primary: '\x1b[38;2;160;70;255m',
}

function resolveWorkerCount(config?: ClusterConfig): number {
  if (process.env.__EXIS_DEV_SERVER === '1') return 1

  if (process.env.EXIS_WORKERS) {
    const parsed = parseInt(process.env.EXIS_WORKERS, 10)
    if (!isNaN(parsed) && parsed > 0) return Math.min(parsed, os.cpus().length)
  }

  const raw = config?.workers ?? 1

  if (raw === false || raw === 0) return 1
  if (raw === 'max') return os.cpus().length
  if (raw === true || raw === 'safe') return Math.min(2, os.cpus().length)
  if (typeof raw === 'number' && raw > 0) return Math.min(raw, os.cpus().length)

  return 1
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Runs the provided function inside a multi-process cluster.
 *
 * - **Primary process**: forks N worker processes and manages their lifecycle
 *   (crash recovery, graceful shutdown).
 * - **Worker process**: executes `workerFn` (typically the HTTP server startup).
 *
 * If `workerCount` resolves to 1, clustering is skipped and `workerFn` runs
 * directly in the current process (zero overhead for single-core / dev mode).
 */
export function runInCluster(
  workerFn: () => void | Promise<void>,
  config?: ClusterConfig
) {
  const workerCount = resolveWorkerCount(config)

  // ─── Single-process mode (no clustering overhead) ─────────────────────────
  if (workerCount <= 1) {
    workerFn()
    return
  }

  // ─── Cluster mode ─────────────────────────────────────────────────────────
  if (cluster.isPrimary) {
    primaryProcess(workerCount, config)
  } else {
    workerFn()
  }
}

// ─── Primary Process ────────────────────────────────────────────────────────────

function primaryProcess(workerCount: number, config?: ClusterConfig) {
  const respawn = config?.respawn !== false
  const maxRespawns = config?.maxRespawns ?? 5
  const respawnWindow = config?.respawnWindow ?? 60_000

  // Track respawn timestamps for crash-loop detection
  const respawnTimestamps: number[] = []

  process.env.__EXIS_CLUSTER_WORKERS = String(workerCount)

  // Fork workers
  for (let i = 0; i < workerCount; i++) {
    const worker = cluster.fork()
    setupWorkerIpc(worker)
  }

  let isShuttingDown = false

  function setupWorkerIpc(worker: import('node:cluster').Worker) {
    worker.on('message', (msg) => {
      // Broadcast cache revalidation to all OTHER workers
      if (msg && msg.type === 'exis:cache:revalidate') {
        for (const id in cluster.workers) {
          const w = cluster.workers[id]
          if (w && w.id !== worker.id) {
            w.send(msg)
          }
        }
      }
    })
  }

  // ─── Worker crash recovery ────────────────────────────────────────────────
  cluster.on('exit', (worker, code, signal) => {
    if (isShuttingDown) return

    const pid = worker.process.pid

    if (signal) {
      console.log(
        `  ${c.yellow}⚠${c.reset} Worker ${c.bold}PID ${pid}${c.reset} killed by signal ${c.yellow}${signal}${c.reset}`
      )
    } else if (code !== 0) {
      console.log(
        `  ${c.red}✗${c.reset} Worker ${c.bold}PID ${pid}${c.reset} exited with error code ${c.red}${code}${c.reset}`
      )
    } else {
      console.log(`  ${c.dim}Worker PID ${pid} exited cleanly${c.reset}`)
      return // Clean exit, no respawn
    }

    if (!respawn) return

    // ─── Crash-loop protection ────────────────────────────────────────────
    const now = Date.now()
    respawnTimestamps.push(now)

    // Remove timestamps outside the window
    while (
      respawnTimestamps.length > 0 &&
      respawnTimestamps[0] < now - respawnWindow
    ) {
      respawnTimestamps.shift()
    }

    if (respawnTimestamps.length > maxRespawns) {
      console.error(
        `\n  ${c.red}${c.bold}✗ Crash loop detected!${c.reset} ${c.red}${maxRespawns} workers crashed within ${respawnWindow / 1000}s.${c.reset}`
      )
      console.error(
        `  ${c.red}Stopping automatic respawn to prevent system overload.${c.reset}\n`
      )
      return
    }

    const newWorker = cluster.fork()
    setupWorkerIpc(newWorker)
    console.log(
      `  ${c.green}↻${c.reset} Replacement worker started ${c.dim}(PID ${newWorker.process.pid})${c.reset}`
    )
  })

  // ─── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = (signal: string) => {
    if (isShuttingDown) return
    isShuttingDown = true

    console.log(
      `\n  ${c.primary}[exis-cluster]${c.reset} Received ${c.yellow}${signal}${c.reset}, shutting down workers...`
    )

    // Send SIGTERM to all workers and let them close gracefully
    for (const id in cluster.workers) {
      cluster.workers[id]?.process.kill('SIGTERM')
    }

    // Give workers a grace period to shut down, then force kill
    const forceTimeout = setTimeout(() => {
      console.log(
        `  ${c.yellow}⚠${c.reset} Grace period expired, force killing remaining workers...`
      )
      for (const id in cluster.workers) {
        cluster.workers[id]?.kill()
      }
      process.exit(1)
    }, 10_000)

    forceTimeout.unref()

    // Wait for all workers to exit
    let aliveCount = Object.keys(cluster.workers ?? {}).length
    cluster.on('exit', () => {
      aliveCount--
      if (aliveCount <= 0) {
        clearTimeout(forceTimeout)
        console.log(
          `  ${c.green}✓${c.reset} All workers stopped. Cluster shut down gracefully.\n`
        )
        process.exit(0)
      }
    })
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

/**
 * Helper utilities exposed for use in other parts of the framework.
 */
export const clusterInfo = {
  /** Whether the current process is the primary (master) cluster process. */
  get isPrimary(): boolean {
    return cluster.isPrimary
  },

  /** Whether the current process is a cluster worker. */
  get isWorker(): boolean {
    return cluster.isWorker
  },

  /** The current worker's ID (undefined on primary). */
  get workerId(): number | undefined {
    return cluster.worker?.id
  },

  /** Total number of active workers (only meaningful on primary). */
  get workerCount(): number {
    return Object.keys(cluster.workers ?? {}).length
  },
}
