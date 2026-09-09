import { describe, test as it, expect } from '../src/testing'
import { App } from '../src/server/app'
import { formatSSEEvent, SSEStream } from '../src/router'
import http from 'node:http'

describe('Server-Sent Events (SSE) Engine', () => {
  it('formatSSEEvent formats basic string and json payloads correctly', () => {
    expect(formatSSEEvent('hello world')).toBe('data: hello world\n\n')
    expect(formatSSEEvent({ count: 42 })).toBe('data: {"count":42}\n\n')

    expect(
      formatSSEEvent({
        event: 'delta',
        id: 'evt-1',
        retry: 3000,
        data: { text: 'chunk' },
      })
    ).toBe('id: evt-1\nevent: delta\nretry: 3000\ndata: {"text":"chunk"}\n\n')

    expect(
      formatSSEEvent({
        event: 'multiline',
        data: 'line 1\nline 2\nline 3',
      })
    ).toBe('event: multiline\ndata: line 1\ndata: line 2\ndata: line 3\n\n')
  })

  it('streams events using res.sse() return value and finishes cleanly', async () => {
    const app = new App()

    app.get('/events', (_req, res) => {
      const sse = res.sse({ heartbeat: false })
      sse.send({ event: 'greeting', data: { msg: 'hello' } })
      sse.send('second-message')
      sse.comment('internal ping')
      sse.close()
    })

    const server = http.createServer((req, res) => app.handle(req, res))

    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as import('node:net').AddressInfo
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: addr.port,
            path: '/events',
            method: 'GET',
          },
          (res) => {
            expect(res.statusCode).toBe(200)
            expect(res.headers['content-type']).toBe(
              'text/event-stream; charset=utf-8'
            )
            expect(res.headers['cache-control']).toBe('no-cache, no-transform')
            expect(res.headers['connection']).toBe('keep-alive')
            expect(res.headers['x-accel-buffering']).toBe('no')

            let body = ''
            res.on('data', (chunk) => {
              body += chunk.toString('utf8')
            })
            res.on('end', () => {
              expect(body).toContain(
                'event: greeting\ndata: {"msg":"hello"}\n\n'
              )
              expect(body).toContain('data: second-message\n\n')
              expect(body).toContain(': internal ping\n\n')
              server.close(() => resolve())
            })
          }
        )
        req.on('error', (err) => {
          server.close(() => reject(err))
        })
        req.end()
      })
    })
  })

  it('supports async handler callback in res.sse(async (sse) => ...)', async () => {
    const app = new App()

    app.get('/ai-stream', (_req, res) => {
      res.sse({ heartbeat: false }, async (sse) => {
        async function* mockLlm() {
          yield { token: 'Hello' }
          yield { token: ' world' }
          yield { token: '!' }
        }

        await sse.pipeFrom(mockLlm(), (chunk) => ({
          event: 'token',
          data: chunk.token,
        }))
      })
    })

    const server = http.createServer((req, res) => app.handle(req, res))

    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as import('node:net').AddressInfo
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: addr.port,
            path: '/ai-stream',
            method: 'GET',
          },
          (res) => {
            let body = ''
            res.on('data', (chunk) => {
              body += chunk.toString('utf8')
            })
            res.on('end', () => {
              expect(body).toContain('event: token\ndata: Hello\n\n')
              expect(body).toContain('event: token\ndata:  world\n\n')
              expect(body).toContain('event: token\ndata: !\n\n')
              server.close(() => resolve())
            })
          }
        )
        req.on('error', (err) => {
          server.close(() => reject(err))
        })
        req.end()
      })
    })
  })

  it('notifies onClose callback when client disconnects', async () => {
    const app = new App()
    let clientDisconnected = false

    app.get('/long-stream', (_req, res) => {
      const sse = res.sse({ heartbeat: false })
      sse.onClose(() => {
        clientDisconnected = true
      })
      sse.send('connected')
    })

    const server = http.createServer((req, res) => app.handle(req, res))

    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as import('node:net').AddressInfo
        const clientReq = http.request(
          {
            hostname: '127.0.0.1',
            port: addr.port,
            path: '/long-stream',
            method: 'GET',
          },
          (res) => {
            res.on('data', () => {
              // Destroy client connection immediately
              clientReq.destroy()
            })
          }
        )

        clientReq.on('close', () => {
          setTimeout(() => {
            expect(clientDisconnected).toBe(true)
            server.close(() => resolve())
          }, 30)
        })

        clientReq.on('error', () => {
          // Expected when calling destroy()
        })

        clientReq.end()
      })
    })
  })
})
