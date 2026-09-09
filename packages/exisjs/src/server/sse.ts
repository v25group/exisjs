import type { ServerResponse } from 'node:http'

export interface SSEMessage {
  /** Event name / type (e.g. 'message', 'delta', 'ping', 'done') */
  event?: string
  /** Data to send: string, number, boolean, or object (automatically JSON-serialized) */
  data: unknown
  /** Optional event ID for reconnect tracking (Last-Event-ID) */
  id?: string | number
  /** Reconnection retry time in milliseconds sent to client */
  retry?: number
}

export interface SSEOptions {
  /**
   * Automatic keep-alive heartbeat interval in milliseconds.
   * Sends an SSE comment (`:\n\n`) periodically to prevent intermediate proxies/NATs
   * and load balancers from timing out the TCP connection.
   * Pass `false` or `0` to disable. Defaults to 15000 (15s).
   */
  heartbeat?: number | false
  /**
   * Custom heartbeat comment payload. Defaults to `": ping\n\n"`.
   */
  heartbeatComment?: string
  /**
   * Custom headers to send with the SSE stream.
   */
  headers?: Record<string, string>
}

/**
 * Encapsulates an active Server-Sent Events stream connected to a client.
 */
export class SSEStream {
  private _raw: ServerResponse
  private _heartbeatTimer?: NodeJS.Timeout
  private _isClosed = false
  private _onCloseCallbacks: (() => void)[] = []

  constructor(
    raw: ServerResponse,
    options: SSEOptions = {},
    rawReq?: import('node:http').IncomingMessage
  ) {
    this._raw = raw

    // Listen to client disconnect on response and request
    raw.once('close', () => {
      this._cleanup()
    })

    if (rawReq) {
      rawReq.once('close', () => {
        this._cleanup()
      })
      rawReq.once('aborted', () => {
        this._cleanup()
      })
    }

    const heartbeatMs =
      options.heartbeat === false || options.heartbeat === 0
        ? 0
        : (options.heartbeat ?? 15000)

    if (heartbeatMs > 0) {
      const comment = options.heartbeatComment ?? ': ping\n\n'
      this._heartbeatTimer = setInterval(() => {
        if (!this._isClosed && !this._raw.writableEnded) {
          try {
            this._raw.write(
              comment.endsWith('\n\n') ? comment : `${comment}\n\n`
            )
          } catch {
            this._cleanup()
          }
        }
      }, heartbeatMs)

      if (this._heartbeatTimer.unref) {
        this._heartbeatTimer.unref()
      }
    }
  }

  /**
   * Whether the client has disconnected or stream has ended.
   */
  get isClosed(): boolean {
    return (
      this._isClosed || this._raw.writableEnded || (this._raw as any).destroyed
    )
  }

  /**
   * Send a formatted SSE event or raw data.
   *
   * @example
   * sse.send({ event: 'delta', data: { text: 'Hello' }, id: '1' })
   * sse.send('Simple string data')
   */
  send(message: SSEMessage | unknown): boolean {
    if (this.isClosed) return false

    const formatted = formatSSEEvent(message)
    try {
      return this._raw.write(formatted)
    } catch {
      this._cleanup()
      return false
    }
  }

  /**
   * Send a raw SSE comment line (prefixed with `: `).
   * Useful for custom heartbeats or telemetry without firing client event listeners.
   */
  comment(text: string): boolean {
    if (this.isClosed) return false
    const line = text ? `: ${text.replace(/\r?\n/g, ' ')}\n\n` : `:\n\n`
    try {
      return this._raw.write(line)
    } catch {
      this._cleanup()
      return false
    }
  }

  /**
   * Pipe an async iterable (e.g. OpenAI / LangChain / Ollama streaming response) directly to the SSE client.
   *
   * @param iterable Async iterable yielding chunks of string or objects
   * @param transform Optional transformer function for each chunk
   */
  async pipeFrom(
    iterable: AsyncIterable<any> | Iterable<any>,
    transform?: (chunk: any) => SSEMessage | unknown
  ): Promise<void> {
    try {
      for await (const chunk of iterable) {
        if (this.isClosed) break
        const msg = transform ? transform(chunk) : chunk
        this.send(msg)
      }
    } finally {
      if (!this.isClosed) {
        this.close()
      }
    }
  }

  /**
   * Register a callback triggered when the client disconnects or the stream ends.
   */
  onClose(cb: () => void): this {
    if (this._isClosed) {
      cb()
    } else {
      this._onCloseCallbacks.push(cb)
    }
    return this
  }

  /**
   * Close the SSE stream and terminate the HTTP response.
   */
  close(): void {
    if (this._isClosed) return
    this._cleanup()
    if (!this._raw.writableEnded) {
      try {
        this._raw.end()
      } catch {
        // noop
      }
    }
  }

  private _cleanup(): void {
    if (this._isClosed) return
    this._isClosed = true

    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = undefined
    }

    const callbacks = this._onCloseCallbacks.splice(0)
    for (const cb of callbacks) {
      try {
        cb()
      } catch {
        // ignore callback error
      }
    }
  }
}

/**
 * Format any input into the SSE standard text protocol:
 *
 * id: 1\n
 * event: message\n
 * retry: 5000\n
 * data: line 1\n
 * data: line 2\n\n
 */
export function formatSSEEvent(message: SSEMessage | unknown): string {
  let output = ''

  if (
    message !== null &&
    typeof message === 'object' &&
    ('data' in message ||
      'event' in message ||
      'id' in message ||
      'retry' in message)
  ) {
    const msg = message as SSEMessage

    if (msg.id !== undefined && msg.id !== null) {
      output += `id: ${msg.id}\n`
    }
    if (msg.event) {
      output += `event: ${msg.event}\n`
    }
    if (msg.retry !== undefined && msg.retry !== null) {
      output += `retry: ${msg.retry}\n`
    }

    const dataPayload = msg.data
    output += formatDataPayload(dataPayload)
  } else {
    // Treat raw primitive or object as data payload
    output += formatDataPayload(message)
  }

  return `${output}\n`
}

function formatDataPayload(data: unknown): string {
  if (data === undefined) {
    return 'data:\n'
  }

  let serialized: string
  if (typeof data === 'string') {
    serialized = data
  } else if (
    typeof data === 'number' ||
    typeof data === 'boolean' ||
    typeof data === 'bigint'
  ) {
    serialized = String(data)
  } else {
    try {
      serialized = JSON.stringify(data)
    } catch {
      serialized = String(data)
    }
  }

  // Multi-line data requires each line to be prefixed with `data: `
  const lines = serialized.split(/\r?\n/)
  return lines.map((line) => `data: ${line}`).join('\n') + '\n'
}
