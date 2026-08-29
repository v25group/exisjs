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

  on(event: string, listener: (...args: any[]) => void): this {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push(listener)
    return this
  }

  emit(event: string, ...args: any[]): boolean {
    const listeners = this._listeners[event]
    if (!listeners || listeners.length === 0) return false
    for (const fn of listeners) fn(...args)
    return true
  }

  readBody(): Promise<Buffer> | undefined {
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
    // no-op
  }
}

export class UwsServerResponse {
  public statusCode = 200
  public headersSent = false

  private _headers: Record<string, string> = Object.create(null)
  public _aborted = false

  private _listeners: Record<string, ((...args: any[]) => void)[]> = {}

  constructor(public _uwsRes: any) {}

  init(uwsRes: any): this {
    this._uwsRes = uwsRes
    this.statusCode = 200
    this.headersSent = false
    this._aborted = false
    // Reset headers — wipe all existing keys
    const h = this._headers
    for (const k in h) delete h[k]
    this._listeners = {}
    return this
  }

  setHeader(name: string, value: string | number | readonly string[]): void {
    this._headers[name.toLowerCase()] = String(value)
  }

  getHeader(name: string): string | undefined {
    return this._headers[name.toLowerCase()]
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
        this._uwsRes.writeStatus(String(this.statusCode))
        for (const key in this._headers) {
          this._uwsRes.writeHeader(key, this._headers[key])
        }
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

    if (this._aborted || this.headersSent) {
      if (callback) callback()
      return
    }
    this.headersSent = true

    this._uwsRes.cork(() => {
      // Write status
      this._uwsRes.writeStatus(String(this.statusCode))

      // Write all headers
      for (const key in this._headers) {
        if (key === 'content-length' && data !== undefined && data !== null) {
          continue // uWebSockets automatically adds Content-Length for data
        }
        this._uwsRes.writeHeader(key, this._headers[key])
      }

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

  // Minimal EventEmitter-like interface

  on(event: string, listener: (...args: any[]) => void): this {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push(listener)
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
      this.off(event, wrapped)
      listener(...args)
    }
    return this.on(event, wrapped)
  }

  off(event: string, listener: (...args: any[]) => void): this {
    const listeners = this._listeners[event]
    if (listeners) {
      const idx = listeners.indexOf(listener)
      if (idx !== -1) listeners.splice(idx, 1)
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
  wsHandler: (req: UwsIncomingMessage, res: any, context: any) => void,
  ssl?: { key: string | Buffer; cert: string | Buffer }
) {
  if (!uWS) {
    throw new Error(
      'uWebSockets.js is not installed. Install it with: npm install uWebSockets.js@github:uNetworking/uWebSockets.js#v20.51.0'
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

  // Register WebSocket handler
  app.ws('/*', {
    idleTimeout: 30,
    maxBackpressure: 1024 * 1024,

    upgrade: (res: any, req: any, context: any) => {
      const shimReq = new UwsIncomingMessage(req, res)
      // Call into app.ts to handle middleware and then upgrade
      wsHandler(shimReq, res, context)
    },

    open: (ws: any) => {
      ws.shim = new UwsWebSocketShim(ws)
      if (ws.exisWs) {
        ws.exisWs.raw = ws.shim
      }
      ws.shim.emit('open')
    },

    message: (ws: any, message: ArrayBuffer, isBinary: boolean) => {
      if (ws.shim) {
        ws.shim.emit('message', Buffer.from(message), isBinary)
      }
    },

    close: (ws: any, code: number, message: ArrayBuffer) => {
      if (ws.shim) {
        ws.shim.emit('close', code, Buffer.from(message))
      }
    },
  })

  // Register a catch-all HTTP handler
  app.any('/*', (uwsRes: any, uwsReq: any) => {
    let aborted = false
    const shimReq = new UwsIncomingMessage(uwsReq, uwsRes)
    const shimRes = new UwsServerResponse(uwsRes)

    uwsRes.onAborted(() => {
      aborted = true
      shimReq._aborted = true
      shimRes._aborted = true
      shimReq.emit('aborted')
      shimReq.emit('close')
      shimRes.emit('close')
    })

    const contentLength = shimReq.headers['content-length']
    if (contentLength && parseInt(contentLength, 10) > 0) {
      shimReq._readBodyPromise = new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        uwsRes.onData((chunk: ArrayBuffer, isLast: boolean) => {
          if (aborted) {
            reject(new Error('aborted'))
            return
          }
          // Buffer.from(ArrayBuffer) already copies the data
          const copy = Buffer.from(chunk)
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
