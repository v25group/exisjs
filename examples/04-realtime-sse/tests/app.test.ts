import { test, describe, it, expect, createTestApp } from 'exisjs/testing'
import { App } from 'exisjs/app'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('04-realtime-sse application', () => {
  it('serves dashboard html and routes live events and broadcast', async () => {
    const app = new App({ env: 'production', server: 'node' })
    const exampleDir = path.resolve(__dirname, '..')
    await (app as any).routeScanner.autoMountRoutes(exampleDir)

    const client = createTestApp(app)

    // 1. Check HTML index
    const indexRes = await client.get('/')
    expect(indexRes.status).toBe(200)
    expect(indexRes.headers['content-type']).toContain('text/html')
    expect(indexRes.text).toContain('ExisJS Live SSE Stream')

    // 2. Check stats endpoint
    const statsRes = await client.get('/events/stats')
    expect(statsRes.status).toBe(200)
    expect(statsRes.headers['x-exis-realtime']).toBe('active')
    expect(statsRes.body.activeSubscribers).toBe(0)

    // 3. Check broadcast POST endpoint with tex validator
    const broadcastRes = await client
      .post('/events/broadcast')
      .send({ message: 'Automated test broadcast' })
    expect(broadcastRes.status).toBe(200)
    expect(broadcastRes.body.success).toBe(true)

    // 4. Check validation rejection for invalid broadcast payload
    const invalidRes = await client
      .post('/events/broadcast')
      .send({ message: '' })
    expect(invalidRes.status).toBe(400)
  })
})
