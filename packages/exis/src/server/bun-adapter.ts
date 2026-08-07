import type { IncomingMessage, ServerResponse } from 'http'

/**
 * Mocks Node.js IncomingMessage for Bun's Web Standard Request
 */
export class BunIncomingMessage {
  method: string
  url: string
  headers: Record<string, string>
  socket: { remoteAddress: string }
  rawReq: any // Bun Request

  private _listeners: Record<string, ((...args: any[]) => any)[]> = {}
  private _bodyEnded = false

  constructor(req: any) {
    this.rawReq = req
    this.method = req.method
    const rawUrl = req.url
    // Fast path: find third slash for path start
    const pathStart = rawUrl.indexOf('/', rawUrl.indexOf('//') + 2)
    this.url = pathStart !== -1 ? rawUrl.substring(pathStart) : '/'

    this.headers = {}
    if (typeof req.headers.toJSON === 'function') {
      this.headers = req.headers.toJSON()
    } else {
      req.headers.forEach((value: string, key: string) => {
        this.headers[key] = value
      })
    }

    // Remote address isn't easily synchronous on the Request object in Bun,
    // it requires server.requestIP(req). We'll default to localhost.
    this.socket = { remoteAddress: '127.0.0.1' }

    if (req.body && !['GET', 'HEAD', 'OPTIONS'].includes(this.method)) {
      this.consumeBody(req)
    } else {
      this._bodyEnded = true
    }
  }

  on(event: string, fn: (...args: any[]) => any) {
    if (event === 'end' && this._bodyEnded) {
      queueMicrotask(() => fn())
      return this
    }
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push(fn)
    return this
  }

  removeAllListeners(event: string) {
    if (this._listeners[event]) {
      this._listeners[event].length = 0
    }
    return this
  }

  emit(event: string, ...args: any[]) {
    if (this._listeners[event]) {
      for (const listener of this._listeners[event]) {
        listener(...args)
      }
    }
  }

  private async consumeBody(req: any) {
    try {
      const arrayBuffer = await req.arrayBuffer()
      if (arrayBuffer.byteLength > 0) {
        this.emit('data', Buffer.from(arrayBuffer))
      }
    } catch (e) {
      this.emit('error', e)
    } finally {
      this.emit('end')
    }
  }
}

/**
 * Mocks Node.js ServerResponse for Bun
 */
export class BunServerResponse {
  statusCode = 200
  headers: Record<string, string | string[]> = {}
  private chunks: Buffer[] = []
  private resolve: (res: any) => void
  private isEnded = false
  private _listeners: Record<string, ((...args: any[]) => any)[]> = {}
  private hasArrayHeaders = false

  constructor(resolve: (res: any) => void) {
    this.resolve = resolve
  }

  on(event: string, fn: (...args: any[]) => any) {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push(fn)
    return this
  }

  emit(event: string, ...args: any[]) {
    if (this._listeners[event]) {
      for (const listener of this._listeners[event]) {
        listener(...args)
      }
    }
  }

  get headersSent() {
    return this.isEnded
  }

  setHeader(name: string, value: string | string[]) {
    this.headers[name] = value
    if (Array.isArray(value)) this.hasArrayHeaders = true
  }

  getHeader(name: string) {
    return this.headers[name]
  }

  hasHeader(name: string) {
    return this.headers[name] !== undefined
  }

  removeHeader(name: string) {
    delete this.headers[name]
  }

  write(chunk: any) {
    if (typeof chunk === 'string') {
      this.chunks.push(Buffer.from(chunk))
    } else if (Buffer.isBuffer(chunk)) {
      this.chunks.push(chunk)
    }
    return true
  }

  end(chunk?: any) {
    if (this.isEnded) return
    this.isEnded = true

    let body: any
    if (this.chunks.length === 0 && chunk) {
      body = chunk
    } else {
      if (chunk) this.write(chunk)
      body =
        this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks)
    }

    let finalHeaders: any = this.headers
    if (this.hasArrayHeaders) {
      finalHeaders = new Headers()
      for (const k in this.headers) {
        const v = this.headers[k]
        if (Array.isArray(v)) {
          for (const item of v) finalHeaders.append(k, item)
        } else {
          finalHeaders.append(k, v as string)
        }
      }
    }

    this.resolve(
      new Response(body, {
        status: this.statusCode,
        headers: finalHeaders,
      })
    )
    this.emit('finish')
  }
}

/**
 * Boots a Bun native server
 */
export function createBunApp(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  upgradeHandler: (req: any, resolve: (res: any) => void, server: any) => void,
  port: number,
  host?: string,
  _options?: any
) {
  if (typeof Bun === 'undefined') {
    throw new Error(
      'Bun is not available in this environment. Please run with bun run.'
    )
  }

  const server = Bun.serve({
    port,
    hostname: host || '0.0.0.0',
    reusePort: true,
    async fetch(req: any, bunServer: any) {
      return new Promise<any>((resolve) => {
        // Upgrade handler check (WebSocket)
        if (req.headers.get('upgrade') === 'websocket') {
          upgradeHandler(req, resolve, bunServer)
          return
        }

        const bunReq = new BunIncomingMessage(req) as unknown as IncomingMessage
        const bunRes = new BunServerResponse(
          resolve
        ) as unknown as ServerResponse
        handler(bunReq, bunRes)
      })
    },
    websocket: {
      open(ws: any) {
        if (ws.data?.exisWs) {
          ws.data.exisWs.handleOpen()
        }
      },
      message(ws: any, message: any) {
        if (ws.data?.exisWs) {
          ws.data.exisWs.handleMessage(message)
        }
      },
      close(ws: any, code: number, reason: string) {
        if (ws.data?.exisWs) {
          ws.data.exisWs.handleClose(code, reason)
        }
      },
    },
  })

  return {
    listen(port: number, host: string, cb: () => void) {
      // Bun.serve already binds to port, so we just invoke the callback
      cb()
      return server
    },
  }
}
