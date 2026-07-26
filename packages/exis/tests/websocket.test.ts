import { App } from '../src/server/app'
import { ExisWebSocket } from '../src/websocket/socket'
import type { Request, Response, NextFunction } from '../src/types'
import WebSocket from 'ws'
import { describe, expect, it, ex, beforeAll, afterAll } from '../src/testing'

describe('WebSocket Support', () => {
  let app: App
  let url: string

  beforeAll(async () => {
    app = new App({ env: 'test', logger: false })

    app.ws('/echo', (ws: ExisWebSocket) => {
      ws.on('message', (msg: any) => {
        ws.send(msg.toString())
      })
    })

    app.ws('/room/:id', (ws: ExisWebSocket, req: Request) => {
      const room = req.params.id
      ws.subscribe(room)

      ws.on('message', (msg: any) => {
        ws.publish(room, msg.toString()) // broadcasts to others
      })
    })

    const authMiddleware = (
      req: Request,
      res: Response,
      next: NextFunction
    ) => {
      if (req.headers.authorization !== 'secret') {
        return res.status(401).json({ error: 'Unauthorized' })
      }
      next()
    }

    app.ws('/protected/chat', authMiddleware, (ws: ExisWebSocket) => {
      ws.send('welcome')
    })

    await new Promise<void>((resolve) => {
      const server = app.listen(0, () => {
        const addr = server.address() as any
        url = `ws://127.0.0.1:${addr.port}`
        resolve()
      })
    })
  })

  afterAll(async () => {
    await Promise.race([
      app.close(10),
      new Promise((resolve) => setTimeout(resolve, 50)),
    ])
  })

  it('connects to websocket and echoes message', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${url}/echo`)

      ws.on('open', () => {
        ws.send('hello world')
      })

      ws.on('message', (data) => {
        try {
          expect(data.toString()).toBe('hello world')
          ws.close()
        } catch (err) {
          reject(err)
        }
      })

      ws.on('close', () => {
        resolve()
      })

      ws.on('error', reject)
    })
  })

  it('rejects upgrade when middleware returns 401', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${url}/protected/chat`)

      ws.on('unexpected-response', (req, res) => {
        try {
          expect(res.statusCode).toBe(401)
          req.destroy()
          resolve()
        } catch (err) {
          reject(err)
        }
      })

      ws.on('error', reject)
    })
  })

  it('accepts upgrade when middleware passes', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${url}/protected/chat`, {
        headers: { authorization: 'secret' },
      })

      ws.on('message', (data) => {
        try {
          expect(data.toString()).toBe('welcome')
          ws.close()
          resolve()
        } catch (err) {
          reject(err)
        }
      })

      ws.on('error', reject)
    })
  })

  it('supports pub/sub room broadcasting', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws1 = new WebSocket(`${url}/room/gaming`)
      const ws2 = new WebSocket(`${url}/room/gaming`)

      let connections = 0

      const onOpen = () => {
        connections++
        if (connections === 2) {
          // ws1 sends a message, ws2 should receive it
          ws1.send('player 1 joined')
        }
      }

      ws1.on('open', onOpen)
      ws2.on('open', onOpen)
      ws1.on('error', reject)
      ws2.on('error', reject)

      ws2.on('message', (data) => {
        try {
          expect(data.toString()).toBe('player 1 joined')
          ws1.close()
          ws2.close()
          resolve()
        } catch (err) {
          reject(err)
        }
      })
    })
  })
})
