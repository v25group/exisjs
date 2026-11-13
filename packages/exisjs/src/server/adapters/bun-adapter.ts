import type { IncomingMessage, ServerResponse } from 'http'
import { validateHeaderName, validateHeaderValue } from 'node:http'
import { HttpError } from '../../error/errors'

// Only present under the Bun runtime; typed locally so the file compiles without @types/bun
declare const Bun: any

type Listener = (...args: any[]) => any

/** The small part of EventEmitter the framework uses on raw requests and responses. */
class Emitter {
  private _listeners: Record<string, Listener[]> = {}

  on(event: string, fn: Listener): this {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push(fn)
    return this
  }

  once(event: string, fn: Listener): this {
    const wrapped: Listener = (...args) => {
      this.removeListener(event, wrapped)
      fn(...args)
    }
    return this.on(event, wrapped)
  }

  off(event: string, fn: Listener): this {
    return this.removeListener(event, fn)
  }

  removeListener(event: string, fn: Listener): this {
    const arr = this._listeners[event]
    const idx = arr ? arr.indexOf(fn) : -1
    if (idx !== -1) arr.splice(idx, 1)
    return this
  }

  removeAllListeners(event?: string): this {
    if (event) delete this._listeners[event]
    else this._listeners = {}
    return this
  }

  emit(event: string, ...args: any[]): boolean {
    const arr = this._listeners[event]
    if (!arr || arr.length === 0) return false
    for (const fn of [...arr]) fn(...args)
    return true
  }
}

/**
 * Mocks Node.js IncomingMessage for Bun's Web Standard Request
 */
export class BunIncomingMessage extends Emitter {
  method: string
  url: string
  headers: Record<string, string>
  socket: { remoteAddress: string }
  rawReq: any // Bun Request
  complete = false

  private _bodyEnded = false

  /** @param remoteAddress The client's address; '' when Bun can't tell, never a guess */
  constructor(req: any, remoteAddress = '', requestTimeout = 60_000) {
    super()
    this.rawReq = req
    this.method = req.method
    const rawUrl = req.url
    // Fast path: find third slash for path start
    const pathStart = rawUrl.indexOf('/', rawUrl.indexOf('//') + 2)
    this.url = pathStart !== -1 ? rawUrl.substring(pathStart) : '/'

    // No prototype, so a header named __proto__ stays an ordinary key
    this.headers = Object.create(null)
    req.headers.forEach((value: string, key: string) => {
      this.headers[key] = value
    })

    this.socket = { remoteAddress }

    if (req.body && !['GET', 'HEAD', 'OPTIONS'].includes(this.method)) {
      this.consumeBody(req, requestTimeout)
    } else {
      this._bodyEnded = true
      this.complete = true
    }
  }

  on(event: string, fn: Listener): this {
    if (event === 'end' && this._bodyEnded) {
      queueMicrotask(() => fn())
      return this
    }
    return super.on(event, fn)
  }

  private _readBodyPromise?: Promise<Buffer>

  private consumeBody(req: any, requestTimeout: number): void {
    this._readBodyPromise = new Promise((resolve, reject) => {
      // Bun only closes idle connections, so a body sent a few bytes at a
      // time would never end: answer 408 when time is up
      const deadline =
        requestTimeout > 0
          ? setTimeout(
              () =>
                reject(
                  new HttpError(
                    'The request body took too long to arrive',
                    408,
                    'REQUEST_TIMEOUT'
                  )
                ),
              requestTimeout
            )
          : undefined
      deadline?.unref?.()
      req
        .arrayBuffer()
        .then((arrayBuffer: ArrayBuffer) => {
          let buf = Buffer.alloc(0)
          if (arrayBuffer.byteLength > 0) {
            buf = Buffer.from(arrayBuffer)
            this.emit('data', buf)
          }
          resolve(buf)
        })
        .catch((e: any) => {
          this.emit('error', e)
          reject(e)
        })
        .finally(() => {
          if (deadline) clearTimeout(deadline)
          this._bodyEnded = true
          this.complete = true
          this.emit('end')
        })
    })
    // A route that never reads the body must not crash the process when the
    // client disconnects: an unhandled rejection stops the runtime
    this._readBodyPromise.catch(() => undefined)
  }

  readBody(_limit?: number): Promise<Buffer> | undefined {
    return this._readBodyPromise
  }

  pipe(): this {
    return this
  }
  unpipe(): this {
    return this
  }
  resume(): this {
    return this
  }
  pause(): this {
    return this
  }
  destroy(): void {
    this.emit('close')
  }
}

// These statuses can't have a body; the Response constructor throws if given one
const NO_BODY = new Set([101, 204, 205, 304])

/**
 * Mocks Node.js ServerResponse for Bun. Nothing is sent until `end()`, unless a
 * handler writes first, which starts a stream: buffering it instead would hold
 * every SSE event until the connection closes.
 */
export class BunServerResponse extends Emitter {
  statusCode = 200
  private headers: Record<string, string | string[]> = Object.create(null)
  private resolve: (res: any) => void
  private controller?: ReadableStreamDefaultController<Uint8Array>
  private started = false
  private ended = false
  private gone = false

  constructor(resolve: (res: any) => void) {
    super()
    this.resolve = resolve
  }

  get headersSent(): boolean {
    return this.started || this.ended
  }

  get writableEnded(): boolean {
    return this.ended || this.gone
  }

  get destroyed(): boolean {
    return this.gone
  }

  setHeader(name: string, value: string | number | readonly string[]): void {
    // A CRLF in a value could otherwise start a new header
    validateHeaderName(name)
    const values = Array.isArray(value)
      ? value.map(String)
      : [String(value as string | number)]
    for (const v of values) validateHeaderValue(name, v)
    this.headers[name.toLowerCase()] = Array.isArray(value) ? values : values[0]
  }

  getHeader(name: string): string | string[] | undefined {
    return this.headers[name.toLowerCase()]
  }

  getHeaders(): Record<string, string | string[]> {
    return { ...this.headers }
  }

  getHeaderNames(): string[] {
    return Object.keys(this.headers)
  }

  hasHeader(name: string): boolean {
    return this.headers[name.toLowerCase()] !== undefined
  }

  removeHeader(name: string): void {
    delete this.headers[name.toLowerCase()]
  }

  writeHead(statusCode: number, headers?: Record<string, any>): this {
    this.statusCode = statusCode
    if (headers) {
      for (const k in headers) this.setHeader(k, headers[k])
    }
    return this
  }

  flushHeaders(): void {
    this.startStream()
  }

  private responseInit(): { status: number; headers: Headers } {
    const headers = new Headers()
    for (const k in this.headers) {
      const v = this.headers[k]
      // Each Set-Cookie must stay its own header line
      for (const item of Array.isArray(v) ? v : [v]) headers.append(k, item)
    }
    return { status: this.statusCode, headers }
  }

  private startStream(): void {
    if (this.started || this.ended) return
    this.started = true
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller
      },
      // The client went away
      cancel: () => this.clientGone(),
    })
    this.resolve(
      new Response(
        NO_BODY.has(this.statusCode) ? null : stream,
        this.responseInit()
      )
    )
  }

  clientGone(): void {
    if (this.gone) return
    this.gone = true
    this.emit('close')
  }

  write(chunk: any, encodingOrCb?: any, cb?: () => void): boolean {
    if (this.writableEnded) return false
    this.startStream()
    const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    try {
      this.controller?.enqueue(data)
    } catch {
      this.clientGone()
      return false
    }
    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb
    if (callback) callback()
    return true
  }

  end(chunk?: any, encodingOrCb?: any, cb?: () => void): void {
    if (typeof chunk === 'function') {
      cb = chunk
      chunk = undefined
    }
    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb
    if (this.ended) {
      if (callback) callback()
      return
    }

    if (this.started) {
      if (chunk !== undefined && chunk !== null) this.write(chunk)
      this.ended = true
      try {
        this.controller?.close()
      } catch {
        // already closed by the client going away
      }
    } else {
      this.ended = true
      const hasBody = !NO_BODY.has(this.statusCode)
      this.resolve(
        new Response(
          hasBody && chunk !== undefined && chunk !== null ? chunk : null,
          this.responseInit()
        )
      )
    }

    this.emit('finish')
    if (callback) callback()
    this.emit('close')
  }
}

/**
 * Boots a Bun native server
 */
export function createBunApp(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  port: number,
  host?: string,
  ssl?: { key: string | Buffer; cert: string | Buffer },
  bodyLimit = 10485760,
  requestTimeout = 60_000
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
    // Bun refuses a larger body itself, so it is never held in memory
    maxRequestBodySize: bodyLimit,
    ...(ssl ? { tls: { key: ssl.key, cert: ssl.cert } } : {}),
    fetch(req: any, bunServer: any) {
      return new Promise<any>((resolve) => {
        const address = bunServer.requestIP(req)?.address ?? ''
        const bunReq = new BunIncomingMessage(req, address, requestTimeout)
        const bunRes = new BunServerResponse(resolve)
        req.signal?.addEventListener?.('abort', () => {
          bunReq.emit('aborted')
          bunReq.emit('close')
          bunRes.clientGone()
        })
        handler(
          bunReq as unknown as IncomingMessage,
          bunRes as unknown as ServerResponse
        )
      })
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
