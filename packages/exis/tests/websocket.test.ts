import { App } from '../src/server/app'
import { ExisWebSocket } from '../src/websocket/socket'
import type { Request, Response, NextFunction } from '../src/types'
import WebSocket from 'ws'

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

  it('connects to websocket and echoes message', (done) => {
    const ws = new WebSocket(`${url}/echo`)

    ws.on('open', () => {
      ws.send('hello world')
    })

    ws.on('message', (data) => {
      expect(data.toString()).toBe('hello world')
      ws.close()
    })

    ws.on('close', () => {
      done()
    })
  })

  it('rejects upgrade when middleware returns 401', (done) => {
    const ws = new WebSocket(`${url}/protected/chat`)

    ws.on('unexpected-response', (req, res) => {
      expect(res.statusCode).toBe(401)
      req.destroy()
      done()
    })
  })

  it('accepts upgrade when middleware passes', (done) => {
    const ws = new WebSocket(`${url}/protected/chat`, {
      headers: { authorization: 'secret' },
    })

    ws.on('message', (data) => {
      expect(data.toString()).toBe('welcome')
      ws.close()
      done()
    })
  })

  it('supports pub/sub room broadcasting', (done) => {
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

    ws2.on('message', (data) => {
      expect(data.toString()).toBe('player 1 joined')
      ws1.close()
      ws2.close()
      done()
    })
  })
})
