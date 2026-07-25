import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { App } from '../server/app'

export class FetchIncomingMessage extends EventEmitter {
  public url: string
  public method: string
  public headers: Record<string, string | string[]>
  public socket: { encrypted: boolean }
  public connection: { encrypted: boolean }
  private bodyBuffer?: Uint8Array

  constructor(request: globalThis.Request, bodyBuffer?: Uint8Array) {
    super()
    const url = new URL(request.url)
    this.url = url.pathname + url.search
    this.method = request.method
    this.headers = {}

    request.headers.forEach((value, key) => {
      if (this.headers[key]) {
        this.headers[key] = `${this.headers[key]}, ${value}`
      } else {
        this.headers[key] = value
      }
    })

    this.socket = { encrypted: url.protocol === 'https:' }
    this.connection = this.socket
    this.bodyBuffer = bodyBuffer
  }

  // Intercept event listeners to immediately push body data if it was pre-read
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    if (event === 'data' && this.bodyBuffer && this.bodyBuffer.length > 0) {
      process.nextTick(() => listener(Buffer.from(this.bodyBuffer!)))
    } else if (event === 'end') {
      process.nextTick(() => listener())
    } else {
      super.on(event, listener)
    }
    return this
  }
}

export class FetchServerResponse extends EventEmitter {
  public statusCode = 200
  public headersSent = false
  public _headers: Record<string, string | string[]> = {}
  public _body: Uint8Array[] = []

  public getHeader(name: string) {
    return this._headers[name.toLowerCase()]
  }

  public setHeader(name: string, value: string | string[]) {
    if (this.headersSent) throw new Error('Headers already sent')
    this._headers[name.toLowerCase()] = value
  }

  public hasHeader(name: string) {
    return name.toLowerCase() in this._headers
  }

  public removeHeader(name: string) {
    delete this._headers[name.toLowerCase()]
  }

  public write(chunk: any) {
    if (typeof chunk === 'string') {
      this._body.push(new TextEncoder().encode(chunk))
    } else if (chunk instanceof Uint8Array) {
      this._body.push(chunk)
    } else if (Buffer.isBuffer(chunk)) {
      this._body.push(new Uint8Array(chunk))
    }
  }

  public end(chunk?: any, cb?: () => void) {
    if (chunk) this.write(chunk)
    this.headersSent = true
    this.emit('finish')
    if (cb) cb()
  }
}

export async function handleFetch(
  app: App,
  request: globalThis.Request,
  env?: any,
  ctx?: any
): Promise<globalThis.Response> {
  let bodyBuffer: Uint8Array | undefined

  if (request.body && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    bodyBuffer = new Uint8Array(await request.arrayBuffer())
  }

  const req = new FetchIncomingMessage(request, bodyBuffer)
  const res = new FetchServerResponse()

  return new Promise((resolve) => {
    res.on('finish', () => {
      const headers = new Headers()
      for (const [key, value] of Object.entries(res._headers)) {
        if (Array.isArray(value)) {
          value.forEach((v) => headers.append(key, String(v)))
        } else {
          headers.set(key, String(value))
        }
      }

      const totalLen = res._body.reduce((acc, chunk) => acc + chunk.length, 0)
      const merged = new Uint8Array(totalLen)
      let offset = 0
      for (const chunk of res._body) {
        merged.set(chunk, offset)
        offset += chunk.length
      }

      const body = totalLen > 0 ? merged : null

      resolve(
        new Response(body, {
          status: res.statusCode,
          headers,
        })
      )
    })

    // Attach env and ctx for edge specific features
    ;(req as any).env = env
    ;(req as any).ctx = ctx

    app.handle(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse
    )
  })
}
