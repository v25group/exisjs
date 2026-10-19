// B1 (docs/REPORT.md, 0.9.2): metrics: { enabled: true } served nothing
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { describe, it, expect, createTestApp } from '../src/testing'
import { App } from '../src/server/app'
import { render, type MetricsSnapshot } from '../src/server/metrics'

function metricValue(text: string, series: string): number | undefined {
  const line = text.split('\n').find((l) => l.startsWith(series + ' '))
  return line === undefined ? undefined : Number(line.slice(series.length + 1))
}

describe('metrics endpoint', () => {
  it('counts requests by route pattern, method and status', async () => {
    const app = new App({ metrics: { enabled: true }, server: 'node' })
    app.get('/users/:id', (req: any) => ({ id: req.params.id }))
    const client = createTestApp(app)

    await client.get('/users/1')
    await client.get('/users/2')
    await client.get('/nope')
    const res = await client.get('/metrics')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/plain; version=0\.0\.4/)
    const text = res.text
    expect(
      metricValue(
        text,
        'http_requests_total{method="GET",route="/users/:id",status="200"}'
      )
    ).toBe(2)
    expect(
      metricValue(
        text,
        'http_requests_total{method="GET",route="(unmatched)",status="404"}'
      )
    ).toBe(1)
    expect(text).not.toContain('/users/1')
    expect(
      metricValue(
        text,
        'http_request_duration_seconds_count{method="GET",route="/users/:id"}'
      )
    ).toBe(2)
    expect(
      metricValue(
        text,
        'http_request_duration_seconds_bucket{method="GET",route="/users/:id",le="+Inf"}'
      )
    ).toBe(2)
    expect(text).toContain('# TYPE http_request_duration_seconds histogram')
    expect(text).toContain('process_resident_memory_bytes ')
    expect(text).toContain('nodejs_eventloop_lag_p99_seconds ')
  })

  it('serves a custom path and accepts metrics: true', async () => {
    const custom = createTestApp(
      new App({ metrics: { enabled: true, path: '/_metrics' } })
    )
    expect((await custom.get('/_metrics')).status).toBe(200)
    expect(
      (await createTestApp(new App({ metrics: true })).get('/metrics')).status
    ).toBe(200)
  })

  it('is off by default', async () => {
    expect((await createTestApp(new App({})).get('/metrics')).status).toBe(404)
  })

  it('sums request series across workers and labels process gauges', () => {
    const snap = (worker: number, n: number): MetricsSnapshot => ({
      worker,
      requests: { 'GET\u0000/a\u0000200': n },
      durations: {
        'GET\u0000/a': {
          buckets: [n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          sum: n / 1000,
          count: n,
        },
      },
      inFlight: 1,
      rss: 100,
      heapUsed: 50,
      eventLoopLagP99: 0.001,
      startTime: 1,
    })
    const text = render([snap(1, 2), snap(2, 3)])
    expect(
      metricValue(
        text,
        'http_requests_total{method="GET",route="/a",status="200"}'
      )
    ).toBe(5)
    expect(
      metricValue(
        text,
        'http_request_duration_seconds_bucket{method="GET",route="/a",le="0.005"}'
      )
    ).toBe(5)
    expect(metricValue(text, 'http_requests_in_flight')).toBe(2)
    expect(metricValue(text, 'process_resident_memory_bytes{worker="1"}')).toBe(
      100
    )
    expect(metricValue(text, 'process_resident_memory_bytes{worker="2"}')).toBe(
      100
    )
  })

  it('escapes label values', () => {
    const text = render([
      {
        requests: { 'GET\u0000/a"b\\c\u0000200': 1 },
        durations: {},
        inFlight: 0,
        rss: 0,
        heapUsed: 0,
        eventLoopLagP99: 0,
        startTime: 0,
      },
    ])
    expect(text).toContain('route="/a\\"b\\\\c"')
  })

  it('reports the whole cluster from whichever worker is scraped', async () => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'exis-metrics-cluster-')
    )
    const src = path.join(__dirname, '../src').replace(/\\/g, '/')
    const script = path.join(dir, 'server.ts')
    await fs.writeFile(
      script,
      `
      import { App } from '${src}/server/app'
      import { runInCluster } from '${src}/server/cluster'
      runInCluster(async () => {
        const app = new App({ metrics: true, server: 'node', logger: false })
        app.get('/ping', () => ({ ok: true }))
        app.listen({ port: Number(process.env.PORT), host: '127.0.0.1' })
      }, { workers: 2 })
      `
    )
    const port = 40000 + Math.floor(Math.random() * 20000)
    const child = spawn(
      process.execPath,
      [...process.execArgv.filter((a) => !a.startsWith('--test')), script],
      {
        env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
        stdio: process.env.DEBUG_METRICS ? 'inherit' : 'ignore',
      }
    )
    try {
      const base = `http://127.0.0.1:${port}`
      // Wait until both workers answer
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(`${base}/ping`)).ok) break
        } catch {
          // not listening yet
        }
        await new Promise((r) => setTimeout(r, 100))
      }
      await new Promise((r) => setTimeout(r, 500))

      const before = await (await fetch(`${base}/metrics`)).text()
      const start =
        metricValue(
          before,
          'http_requests_total{method="GET",route="/ping",status="200"}'
        ) ?? 0
      for (let i = 0; i < 20; i++) {
        await fetch(`${base}/ping`, { headers: { connection: 'close' } })
      }
      // Each scrape may land on another worker; every one must see all 20
      for (let i = 0; i < 4; i++) {
        const text = await (
          await fetch(`${base}/metrics`, { headers: { connection: 'close' } })
        ).text()
        expect(
          metricValue(
            text,
            'http_requests_total{method="GET",route="/ping",status="200"}'
          )
        ).toBe(start + 20)
        expect(text).toContain('process_resident_memory_bytes{worker="1"}')
        expect(text).toContain('process_resident_memory_bytes{worker="2"}')
      }
    } finally {
      child.kill('SIGTERM')
      await new Promise((r) => setTimeout(r, 300))
      if (child.exitCode === null) child.kill('SIGKILL')
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
