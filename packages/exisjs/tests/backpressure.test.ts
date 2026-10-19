// B2 (docs/REPORT.md, 0.9.2): the queue config was accepted but never read
import http from 'node:http'
import { describe, it, expect, createTestApp } from '../src/testing'
import { App } from '../src/server/app'
import { resolveQueueConfig } from '../src/middleware/backpressure'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('queue config', () => {
  it('rejects drivers other than memory, unknown keys and bad numbers', () => {
    expect(() => resolveQueueConfig({ driver: 'redis' })).toThrow(
      /queue\.driver "redis" is not supported/
    )
    expect(() =>
      resolveQueueConfig({ driver: 'memory', enableWorkers: true })
    ).toThrow(/Unknown option queue\.enableWorkers/)
    expect(() => resolveQueueConfig({ maxConcurrent: 0 })).toThrow(
      /queue\.maxConcurrent must be an integer >= 1/
    )
    expect(() => resolveQueueConfig('memory')).toThrow(/must be an object/)
    expect(resolveQueueConfig(undefined)).toBeUndefined()
    expect(resolveQueueConfig({ driver: 'memory', maxQueue: 0 })).toEqual({
      maxConcurrent: undefined,
      maxQueue: 0,
      timeoutMs: undefined,
    })
  })

  it('stops the server from starting with an unsupported driver', () => {
    const app = new App({ queue: { driver: 'redis' as any } })
    expect(() => app.listen({ port: 0 })).toThrow(/queue\.driver "redis"/)
  })

  it('answers 503 once maxConcurrent and maxQueue are full', async () => {
    const app = new App({ queue: { maxConcurrent: 1, maxQueue: 0 } })
    // The first request holds the only slot until the test opens the gate
    let open!: () => void
    let entered!: () => void
    const gate = new Promise<void>((r) => (open = r))
    const inside = new Promise<void>((r) => (entered = r))
    app.get('/slow', async () => {
      entered()
      await gate
      return { ok: true }
    })
    const client = createTestApp(app)
    // The test client sends a request only once it is awaited
    const first = Promise.resolve(client.get('/slow'))
    await inside
    expect((await client.get('/slow')).status).toBe(503)
    open()
    expect((await first).status).toBe(200)
    expect((await client.get('/slow')).status).toBe(200)
  })

  it('lets a waiting request through when a slot frees up', async () => {
    const app = new App({ queue: { maxConcurrent: 1, maxQueue: 5 } })
    app.get('/slow', async () => {
      await sleep(50)
      return { ok: true }
    })
    const client = createTestApp(app)
    const results = await Promise.all([
      client.get('/slow'),
      client.get('/slow'),
    ])
    expect(results.map((r) => r.status)).toEqual([200, 200])
  })

  it('frees the slot of a response sent without res.end()', async () => {
    const app = new App({ queue: { maxConcurrent: 1, maxQueue: 0 } })
    app.get('/raw', (_req: any, res: any) => {
      res.raw.end('streamed')
    })
    const client = createTestApp(app)
    for (let i = 0; i < 3; i++) {
      expect((await client.get('/raw')).status).toBe(200)
    }
  })

  it('frees the slot of a client that disconnects', async () => {
    const app = new App({ queue: { maxConcurrent: 1, maxQueue: 0 } })
    let release!: () => void
    app.get('/hang', () => new Promise((r) => (release = () => r({ ok: 1 }))))
    app.get('/ok', () => ({ ok: true }))
    const server = app.listen({ port: 0, host: '127.0.0.1' })
    await new Promise((r) => server.once('listening', r))
    const port = (server.address() as any).port
    try {
      const aborted = http.get(`http://127.0.0.1:${port}/hang`)
      aborted.on('error', () => {})
      await sleep(50)
      aborted.destroy()
      await sleep(50)
      const res = await fetch(`http://127.0.0.1:${port}/ok`)
      expect(res.status).toBe(200)
    } finally {
      release?.()
      await new Promise((r) => server.close(r))
    }
  })
})
