/**
 * uWebSockets.js Server Adapter for Exis
 *
 * This module provides a high-performance server backend using uWebSockets.js
 * as a drop-in replacement for Node's native HTTP module. When uWebSockets.js
 * is installed, Exis will auto-detect and use it for dramatically higher throughput.
 *
 * uWebSockets.js bypasses Node's network layer entirely, using optimized C++
 * for socket handling, I/O batching, and direct V8 memory access.
 */

let uWS: any

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  uWS = require('uWebSockets.js')
} catch {
  // uWebSockets.js is optional — will be null if not installed
}

/**
 * Returns true if uWebSockets.js is available on this platform.
 */
export function isUwsAvailable(): boolean {
  return uWS !== undefined && uWS !== null
}

/**
 * Returns the uWS module if available.
 */

export function getUws(): any {
  return uWS
}

// ─── Request Shim ────────────────────────────────────────────────────────────

/**
 * A lightweight shim that wraps a uWS.HttpRequest to provide the same interface
 * that ExisRequest expects from Node's IncomingMessage.
 *
 * IMPORTANT: uWS HttpRequest is only valid during the initial synchronous callback.
 * All headers, URL, and method MUST be copied synchronously before any async work.
 */
export class UwsIncomingMessage {
  public method: string
  public url: string
  public headers: Record<string, string | undefined>
  public socket: {
    remoteAddress: string
    encrypted?: boolean
  }
  public complete = false

  private _listeners: Record<string, ((...args: any[]) => void)[]> = {}
  private _bufferedData: Buffer[] = []
  private _hasEnded = false

  constructor(req: any, res: any) {
    // Copy everything synchronously — uWS.HttpRequest is invalidated after return
    this.method = req.getMethod().toUpperCase()
    this.url = req.getUrl() + (req.getQuery() ? '?' + req.getQuery() : '')

    // Copy headers
    this.headers = {}
    req.forEach((key: string, value: string) => {
      this.headers[key] = value
    })

    // Extract remote address
    const addrBuf = res.getRemoteAddressAsText()
    this.socket = {
      remoteAddress: Buffer.from(addrBuf).toString(),
    }
  }

  // Minimal EventEmitter-like interface for body parsing

  on(event: string, listener: (...args: any[]) => void): this {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push(listener)

    if (event === 'data' && this._bufferedData.length > 0) {
      for (const chunk of this._bufferedData) {
        listener(chunk)
      }
      this._bufferedData = []
    }
    if (event === 'end' && this._hasEnded) {
      listener()
    }

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
    if (!listeners || listeners.length === 0) {
      if (event === 'data') this._bufferedData.push(args[0])
      if (event === 'end') this._hasEnded = true
      return false
    }
    for (const fn of listeners) fn(...args)
    return true
  }

  destroy(): void {
    this._listeners = {}
  }
}

// ─── Response Shim ───────────────────────────────────────────────────────────

/**
 * A lightweight shim that wraps a uWS.HttpResponse to provide the same interface
 * that ExisResponse expects from Node's ServerResponse.
 *
 * Uses uWS cork() for I/O batching — all header and body writes happen in a
 * single syscall for maximum throughput.
 */
export class UwsServerResponse {
  public statusCode = 200
  public headersSent = false

  private _headers = new Map<string, string>()
  private _aborted = false

  private _listeners: Record<string, ((...args: any[]) => void)[]> = {}

  constructor(public readonly _uwsRes: any) {
    // Track abort state
    _uwsRes.onAborted(() => {
      this._aborted = true
      this.emit('close')
    })
  }

  setHeader(name: string, value: string | number | readonly string[]): void {
    this._headers.set(name.toLowerCase(), String(value))
  }

  getHeader(name: string): string | undefined {
    return this._headers.get(name.toLowerCase())
  }

  hasHeader(name: string): boolean {
    return this._headers.has(name.toLowerCase())
  }

  removeHeader(name: string): void {
    this._headers.delete(name.toLowerCase())
  }

  write(chunk: string | Buffer): boolean {
    if (this._aborted) return false

    let result = false
    this._uwsRes.cork(() => {
      if (!this.headersSent) {
        this.headersSent = true
        this._uwsRes.writeStatus(String(this.statusCode))
        for (const [key, value] of this._headers) {
          this._uwsRes.writeHeader(key, value)
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
      for (const [key, value] of this._headers) {
        if (key === 'content-length' && data !== undefined && data !== null) {
          continue // uWebSockets automatically adds Content-Length for data
        }
        this._uwsRes.writeHeader(key, value)
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
 * @param handler - The request handler function (typically App.handleUws)
 * @param wsHandler - The websocket upgrade handler function (typically App.handleUwsUpgrade)
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
      // ws.exisWs is attached during upgrade in app.ts
      if (ws.exisWs) {
        ws.exisWs.raw = ws.shim // Make sure ExisWebSocket uses our shim
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
    const shimReq = new UwsIncomingMessage(uwsReq, uwsRes)
    const shimRes = new UwsServerResponse(uwsRes)

    // Read body using uWS native onData/onAborted
    const contentLength = shimReq.headers['content-length']
    if (contentLength && parseInt(contentLength, 10) > 0) {
      const chunks: Buffer[] = []
      uwsRes.onData((chunk: ArrayBuffer, isLast: boolean) => {
        // We MUST copy the ArrayBuffer because uWS frees the memory immediately
        const copy = Buffer.alloc(chunk.byteLength)
        Buffer.from(chunk).copy(copy)
        chunks.push(copy)
        if (isLast) {
          shimReq.complete = true
          setImmediate(() => {
            shimReq.emit('data', Buffer.concat(chunks))
            shimReq.emit('end')
          })
        }
      })
    } else {
      // No body — emit end immediately
      shimReq.complete = true
      // Use setImmediate to ensure handler has time to register listeners
      setImmediate(() => shimReq.emit('end'))
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
