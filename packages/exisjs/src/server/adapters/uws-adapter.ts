import { validateHeaderName, validateHeaderValue } from 'node:http'
import { HttpError } from '../../error/errors'

let uWS: any
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  uWS = require('uWebSockets.js')
} catch {
  // uWS is not available
}

// ─── HTTP Mocks ────────────────────────────────────────────────────────────────

export class UwsIncomingMessage {
  public method: string
  public url: string
  public headers: Record<string, string> = Object.create(null)

  public _aborted = false
  public complete = false
  public _readBodyPromise?: Promise<Buffer>

  private _listeners: Record<string, ((...args: any[]) => void)[]> = {}

  constructor(
    public _uwsReq: any,
    public _uwsRes: any
  ) {
    this.method = _uwsReq.getMethod().toUpperCase()
    this.url = _uwsReq.getUrl()
    const query = _uwsReq.getQuery()
    if (query) {
      this.url += '?' + query
    }

    _uwsReq.forEach((k: string, v: string) => {
      this.headers[k] = v
    })
  }

  init(uwsReq: any, uwsRes: any): this {
    this._uwsReq = uwsReq
    this._uwsRes = uwsRes
    this.method = uwsReq.getMethod().toUpperCase()
    this.url = uwsReq.getUrl()
    const query = uwsReq.getQuery()
    if (query) {
      this.url += '?' + query
    }

    // Reset headers — wipe all existing keys
    const h = this.headers
    for (const k in h) delete h[k]
    uwsReq.forEach((k: string, v: string) => {
      h[k] = v
    })

    this._aborted = false
    this.complete = false
    this._readBodyPromise = undefined
    this._listeners = {}
    this._remoteAddress = undefined
    return this
  }

  private _remoteAddress?: string

  get socket() {
    return {
      remoteAddress: this._getRemoteAddress(),
    }
  }

  get connection() {
    return this.socket
  }

  private _getRemoteAddress(): string {
    if (this._remoteAddress) return this._remoteAddress
    if (this._aborted) return '127.0.0.1'
    try {
      const proxyIp = this._uwsRes.getProxiedRemoteAddressAsText()
      if (proxyIp && proxyIp.byteLength > 0) {
        this._remoteAddress = Buffer.from(proxyIp).toString('utf8')
        return this._remoteAddress
      }
      const remoteIp = this._uwsRes.getRemoteAddressAsText()
      if (remoteIp && remoteIp.byteLength > 0) {
        this._remoteAddress = Buffer.from(remoteIp).toString('utf8')
        return this._remoteAddress
      }
    } catch {
      // ignore
    }
    this._remoteAddress = '127.0.0.1'
    return this._remoteAddress
  }

  get destroyed(): boolean {
    return this._aborted
  }

  on(event: string, listener: (...args: any[]) => void): this {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push(listener)
    return this
  }

  once(event: string, listener: (...args: any[]) => void): this {
    const wrapped = (...args: any[]) => {
      this.removeListener(event, wrapped)
      listener(...args)
    }
    return this.on(event, wrapped)
  }

  off(event: string, listener: (...args: any[]) => void): this {
    return this.removeListener(event, listener)
  }

  removeListener(event: string, listener: (...args: any[]) => void): this {
    const arr = this._listeners[event]
    if (arr) {
      const idx = arr.indexOf(listener)
      if (idx !== -1) arr.splice(idx, 1)
    }
    return this
  }

  removeAllListeners(event?: string): this {
    if (event) {
      delete this._listeners[event]
    } else {
      this._listeners = {}
    }
    return this
  }

  emit(event: string, ...args: any[]): boolean {
    const listeners = this._listeners[event]
    if (!listeners || listeners.length === 0) return false
    for (const fn of listeners) fn(...args)
    return true
  }

  // The limit is enforced while the body arrives; see createUwsApp
  readBody(_limit?: number): Promise<Buffer> | undefined {
    return this._readBodyPromise
  }

  pipe(): any {
    return this
  }
  unpipe(): any {
    return this
  }
  resume(): any {
    return this
  }
  pause(): any {
    return this
  }
  destroy(): void {
    this._aborted = true
  }
}

export class UwsServerResponse {
  public statusCode = 200
  public headersSent = false

  private _headers: Record<string, string | string[]> = Object.create(null)
  public _aborted = false
  private _ended = false

  private _listeners: Record<string, ((...args: any[]) => void)[]> = {}

  constructor(public _uwsRes: any) {}

  init(uwsRes: any): this {
    this._uwsRes = uwsRes
    this.statusCode = 200
    this.headersSent = false
    this._aborted = false
    this._ended = false
    // Reset headers — wipe all existing keys
    const h = this._headers
    for (const k in h) delete h[k]
    this._listeners = {}
    return this
  }

  setHeader(name: string, value: string | number | readonly string[]): void {
    // uWS writes header bytes as given. Node's own checks stop a CRLF in a
    // value from starting a new header (response splitting)
    validateHeaderName(name)
    const values = Array.isArray(value)
      ? value.map(String)
      : [String(value as string | number)]
    for (const v of values) validateHeaderValue(name, v)
    this._headers[name.toLowerCase()] = Array.isArray(value)
      ? values
      : values[0]
  }

  getHeader(name: string): string | string[] | undefined {
    return this._headers[name.toLowerCase()]
  }

  private writeHeaders(skipLength: boolean): void {
    this._uwsRes.writeStatus(String(this.statusCode))
    for (const key in this._headers) {
      // uWebSockets automatically adds Content-Length for data
      if (skipLength && key === 'content-length') continue
      const value = this._headers[key]
      // Each Set-Cookie must stay its own header line
      for (const v of Array.isArray(value) ? value : [value]) {
        this._uwsRes.writeHeader(key, v)
      }
    }
  }

  hasHeader(name: string): boolean {
    return this._headers[name.toLowerCase()] !== undefined
  }

  removeHeader(name: string): void {
    delete this._headers[name.toLowerCase()]
  }

  write(chunk: string | Buffer): boolean {
    if (this._aborted) return false

    let result = false
    this._uwsRes.cork(() => {
      if (!this.headersSent) {
        this.headersSent = true
        this.writeHeaders(true)
      }
      result = this._uwsRes.write(chunk)
    })

    return result
  }

  end(data?: any, callback?: () => void): void {
    if (typeof data === 'function') {
      callback = data
      data = undefined
    }

    if (this._aborted || this._ended) {
      if (callback) callback()
      return
    }
    this._ended = true
    const streaming = this.headersSent
    this.headersSent = true

    this._uwsRes.cork(() => {
      // A stream has already written its status and headers
      if (!streaming) this.writeHeaders(data !== undefined && data !== null)

      // Write body and end
      if (data !== undefined && data !== null) {
        if (Buffer.isBuffer(data)) {
          this._uwsRes.end(data)
        } else if (typeof data === 'string') {
          this._uwsRes.end(data)
        } else {
          this._uwsRes.end(String(data))
        }
      } else {
        this._uwsRes.end()
      }
    })

    this.emit('finish')
    if (callback) callback()
  }

  get writableEnded(): boolean {
    return this._ended || this._aborted
  }

  get destroyed(): boolean {
    return this._aborted
  }

  getHeaders(): Record<string, string | string[]> {
    return { ...this._headers }
  }

  getHeaderNames(): string[] {
    return Object.keys(this._headers)
  }

  flushHeaders(): void {
    // uWS flushes headers on write/end
  }

  writeHead(statusCode: number, headers?: Record<string, any>): this {
    this.statusCode = statusCode
    if (headers) {
      for (const k in headers) {
        this.setHeader(k, headers[k])
      }
    }
    return this
  }

  on(event: string, listener: (...args: any[]) => void): this {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push(listener)
    return this
  }

  once(event: string, listener: (...args: any[]) => void): this {
    const wrapped = (...args: any[]) => {
      this.removeListener(event, wrapped)
      listener(...args)
    }
    return this.on(event, wrapped)
  }

  off(event: string, listener: (...args: any[]) => void): this {
    return this.removeListener(event, listener)
  }

  removeListener(event: string, listener: (...args: any[]) => void): this {
    const arr = this._listeners[event]
    if (arr) {
      const idx = arr.indexOf(listener)
      if (idx !== -1) arr.splice(idx, 1)
    }
    return this
  }

  removeAllListeners(event?: string): this {
    if (event) {
      delete this._listeners[event]
    } else {
      this._listeners = {}
    }
    return this
  }

  emit(event: string, ...args: any[]): boolean {
    const listeners = this._listeners[event]
    if (!listeners || listeners.length === 0) return false
    for (const fn of listeners) fn(...args)
    return true
  }

  assignSocket(): void {
    // no-op for compatibility
  }
}

// ─── WebSocket Shim ────────────────────────────────────────────────────────────

export class UwsWebSocketShim {
  public readyState = 1 // OPEN

  private _listeners: Record<string, ((...args: any[]) => void)[]> = {}

  constructor(public readonly _uwsWs: any) {}

  send(data: any): void {
    if (this.readyState !== 1) return
    const isBinary = Buffer.isBuffer(data) || data instanceof Uint8Array
    this._uwsWs.send(data, isBinary)
  }

  close(code?: number, data?: string | Buffer): void {
    this.readyState = 3 // CLOSED
    this._uwsWs.end(code, data)
  }

  terminate(): void {
    this.readyState = 3 // CLOSED
    this._uwsWs.close()
  }

  on(event: string, listener: (...args: any[]) => void): this {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push(listener)
    return this
  }

  once(event: string, listener: (...args: any[]) => void): this {
    const wrapped = (...args: any[]) => {
      this.removeListener(event, wrapped)
      listener(...args)
    }
    return this.on(event, wrapped)
  }

  off(event: string, listener: (...args: any[]) => void): this {
    return this.removeListener(event, listener)
  }

  removeListener(event: string, listener: (...args: any[]) => void): this {
    const arr = this._listeners[event]
    if (arr) {
      const idx = arr.indexOf(listener)
      if (idx !== -1) arr.splice(idx, 1)
    }
    return this
  }

  removeAllListeners(event?: string): this {
    if (event) {
      delete this._listeners[event]
    } else {
      this._listeners = {}
    }
    return this
  }

  emit(event: string, ...args: any[]): boolean {
    const listeners = this._listeners[event]
    if (!listeners || listeners.length === 0) return false
    for (const fn of listeners) fn(...args)
    return true
  }
}

// ─── Server Factory ──────────────────────────────────────────────────────────

export interface UwsListenToken {
  token: any
  port: number
}

/**
 * Creates a uWebSockets.js HTTP server that delegates request handling to Exis.
 *
 * @param handler - The request handler function
 * @param wsHandler - The websocket upgrade handler function
 * @param ssl - Optional SSL configuration
 * @returns The uWS App instance and helper methods
 */
export function createUwsApp(
  handler: (req: UwsIncomingMessage, res: UwsServerResponse) => void,
  ssl?: { key: string | Buffer; cert: string | Buffer },
  bodyLimit = 10485760
) {
  if (!uWS) {
    throw new Error(
      'uWebSockets.js is not installed. Install it with: npm install https://github.com/uNetworking/uWebSockets.js/archive/refs/tags/v20.71.0.tar.gz'
    )
  }

  let app: any
  if (ssl) {
    app = uWS.SSLApp({
      key_file_name: typeof ssl.key === 'string' ? ssl.key : undefined,
      cert_file_name: typeof ssl.cert === 'string' ? ssl.cert : undefined,
    })
  } else {
    app = uWS.App()
  }

  // Register a catch-all HTTP handler
  app.any('/*', (uwsRes: any, uwsReq: any) => {
    let aborted = false
    let rejectBody: ((err: Error) => void) | undefined
    const shimReq = new UwsIncomingMessage(uwsReq, uwsRes)
    const shimRes = new UwsServerResponse(uwsRes)

    uwsRes.onAborted(() => {
      aborted = true
      rejectBody?.(new Error('Request aborted by client'))
      shimReq._aborted = true
      shimRes._aborted = true
      shimReq.emit('aborted')
      shimReq.emit('close')
      shimRes.emit('close')
    })

    const contentLength = shimReq.headers['content-length']
    const hasBody =
      (contentLength && parseInt(contentLength, 10) > 0) ||
      shimReq.headers['transfer-encoding'] !== undefined
    if (hasBody) {
      shimReq._readBodyPromise = new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        let size = 0
        let refused = false
        rejectBody = reject
        uwsRes.onData((chunk: ArrayBuffer, isLast: boolean) => {
          if (aborted) {
            reject(new Error('aborted'))
            return
          }
          if (refused) return
          // Enforced here: uWS buffers nothing, so nothing else would stop it
          size += chunk.byteLength
          if (size > bodyLimit) {
            refused = true
            chunks.length = 0
            reject(
              HttpError.payloadTooLarge(
                `Request body exceeds limit of ${bodyLimit} bytes. Configure 'bodyLimit' in 'exis.config.ts' to allow larger payloads.`
              )
            )
            return
          }
          // uWS detaches this ArrayBuffer when the callback returns, and
          // Buffer.from(arrayBuffer) only wraps it, so the bytes must be copied
          const copy = Buffer.from(new Uint8Array(chunk))
          chunks.push(copy)

          shimReq.emit('data', copy)

          if (isLast) {
            shimReq.complete = true
            const finalBody = Buffer.concat(chunks)
            shimReq.emit('end')
            resolve(finalBody)
          }
        })
      })
      // A route that never reads the body must not crash the process when the
      // client disconnects: an unhandled rejection stops Node by default
      shimReq._readBodyPromise.catch(() => undefined)
    } else {
      shimReq.complete = true
      shimReq.emit('end')
    }

    handler(shimReq, shimRes)
  })

  return {
    app,
    listen(
      port: number,
      host: string,
      cb: (token: UwsListenToken | null) => void
    ): void {
      app.listen(host, port, (token: unknown) => {
        if (token) {
          cb({ token, port })
        } else {
          cb(null)
        }
      })
    },
    close(token: unknown): void {
      if (token) {
        uWS.us_listen_socket_close(token)
      }
    },
  }
}
