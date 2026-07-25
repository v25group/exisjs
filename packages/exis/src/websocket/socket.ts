import type { WebSocket, RawData } from 'ws'
import { randomUUID } from 'node:crypto'
import type { ExisWebSocketServer } from './server'
import type { Request } from '../types'

/**
 * An enhanced wrapper around the native `ws` WebSocket instance.
 * Provides built-in pub/sub (room) functionality and seamless JSON serialization.
 */
export class ExisWebSocket {
  public readonly raw: WebSocket
  public readonly req: Request
  public readonly id: string
  public rooms = new Set<string>()
  public data: Record<string, any> = {}
  public latency = 0
  private lastPingTime = 0
  public isAlive = true
  public readonly server: ExisWebSocketServer

  constructor(ws: WebSocket, req: Request, server: ExisWebSocketServer) {
    this.raw = ws
    this.req = req
    this.server = server
    this.id = randomUUID()

    // Listen for pong messages to verify connection is alive and track latency
    this.raw.on('pong', () => {
      this.isAlive = true
      if (this.lastPingTime > 0) {
        this.latency = Date.now() - this.lastPingTime
      }
    })
  }

  /**
   * Internal method called by the server heartbeat
   */
  _ping(): void {
    this.lastPingTime = Date.now()
    this.raw.ping()
  }

  /**
   * Subscribes this socket to a specific room.
   */
  subscribe(room: string): void {
    this.rooms.add(room)
    this.server.subscribe(this, room)

    if (this.server.presenceEnabled) {
      this.broadcast
        .to(room)
        .emit('room:join', { id: this.id, data: this.data, room })
    }
  }

  /**
   * Alias for \`subscribe()\` to mirror Socket.io's API.
   */
  join(room: string): void {
    this.subscribe(room)
  }

  /**
   * Unsubscribes this socket from a specific room.
   */
  unsubscribe(room: string): void {
    if (this.server.presenceEnabled && this.rooms.has(room)) {
      this.broadcast
        .to(room)
        .emit('room:leave', { id: this.id, data: this.data, room })
    }
    this.rooms.delete(room)
    this.server.unsubscribe(this, room)
  }

  /**
   * Alias for \`unsubscribe()\` to mirror Socket.io's API.
   */
  leave(room: string): void {
    this.unsubscribe(room)
  }

  /**
   * Unsubscribes this socket from all rooms it is currently in.
   */
  unsubscribeAll(): void {
    for (const room of this.rooms) {
      this.unsubscribe(room)
    }
  }

  /**
   * Alias for \`unsubscribeAll()\`
   */
  leaveAll(): void {
    this.unsubscribeAll()
  }

  /**
   * Publishes a message to all sockets subscribed to the specified room.
   * By default, the sender (this socket) is excluded from receiving the broadcast.
   * @param room The room to publish to
   * @param data The data to send (objects are automatically JSON stringified)
   * @param excludeSelf Whether to exclude this socket from the broadcast (default: true)
   */
  publish(room: string, data: unknown, excludeSelf = true): void {
    this.server.publish(room, data, excludeSelf ? this : undefined)
  }

  /**
   * Sends data directly to this socket.
   * Objects are automatically JSON stringified.
   */
  send(data: unknown): void {
    if (this.raw.readyState !== 1 /* WebSocket.OPEN */) return

    if (typeof data === 'object' && data !== null && !Buffer.isBuffer(data)) {
      this.raw.send(JSON.stringify(data))
    } else {
      this.raw.send(data as string | Buffer | Uint8Array)
    }
  }

  /**
   * Emits a named JSON event with data directly to this socket.
   * Designed to mirror Socket.io's API.
   * @example socket.emit('chat', { message: 'hello' })
   */
  emit(event: string, data?: unknown): void {
    this.send({ event, data })
  }

  /**
   * Emits an event and waits for the client to acknowledge it.
   * A UUID is sent as the request ID. The client must emit a corresponding response with the same ID.
   */
  emitWithAck(event: string, data?: unknown, timeoutMs = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const ackId = randomUUID()

      const timeout = setTimeout(() => {
        this.off('message', ackListener)
        reject(new Error(`Ack timeout for event ${event}`))
      }, timeoutMs)

      const ackListener = (raw: RawData) => {
        try {
          const payload = JSON.parse(raw.toString())
          if (payload && payload.ackId === ackId) {
            clearTimeout(timeout)
            this.off('message', ackListener)
            resolve(payload.data)
          }
        } catch {
          /* noop */
        }
      }

      this.on('message', ackListener)
      this.send({ event, data, ackId })
    })
  }

  /**
   * Returns a volatile interface to emit events. Volatile events are dropped
   * if the WebSocket connection is currently saturated or not ready.
   */
  get volatile() {
    return {
      emit: (event: string, data?: unknown) => {
        // Drop message if bufferedAmount > 0 (socket is backpressured)
        if (this.raw.readyState === 1 && this.raw.bufferedAmount === 0) {
          this.emit(event, data)
        }
      },
    }
  }

  /**
   * Returns a chainable interface to emit a named event to a specific room.
   * Excludes the sender by default, just like Socket.io.
   * @example socket.to('room1').emit('chat', { message: 'hello' })
   */
  to(room: string) {
    return {
      emit: (event: string, data?: unknown) => {
        this.publish(room, { event, data }, true)
      },
    }
  }

  /**
   * Provides a Socket.io-like \`broadcast\` property to emit events
   * to everyone except the sender.
   */
  get broadcast() {
    return {
      /**
       * Broadcasts to all connected sockets across all rooms (except sender).
       */
      emit: (event: string, data?: unknown) => {
        // Technically this relies on the server to broadcast everywhere except this socket.
        // We will implement a server broadcast excluding self.
        const payload = JSON.stringify({ event, data })
        // Access private server clients (we should safely do this via a server method)
        // Wait, it's better to delegate this to server!
        // For simplicity, we just publish to a global room, or manually loop here.
        // @ts-expect-error accessing internal server
        for (const client of this.server.clients) {
          if (client !== this && client.raw.readyState === 1) {
            client.raw.send(payload)
          }
        }
      },
      /**
       * Broadcasts to a specific room (except sender).
       */
      to: (room: string) => this.to(room),
    }
  }

  /**
   * Closes the connection.
   */
  close(code?: number, data?: string | Buffer): void {
    this.raw.close(code, data)
  }

  // ─── Event Emitter Wrappers ───────────────────────────────────────────────────

  on(
    event: 'message',
    listener: (data: RawData, isBinary: boolean) => void
  ): this
  on(event: 'close', listener: (code: number, reason: Buffer) => void): this
  on(event: 'error', listener: (err: Error) => void): this

  on(event: string | symbol, listener: (...args: any[]) => void): this {
    this.raw.on(event, listener)
    return this
  }

  once(event: string | symbol, listener: (...args: any[]) => void): this {
    this.raw.once(event, listener)
    return this
  }

  off(event: string | symbol, listener: (...args: any[]) => void): this {
    this.raw.off(event, listener)
    return this
  }

  /**
   * Listens for a named JSON event from this socket.
   * Intercepts incoming messages, parses them as JSON, and triggers if the `event` field matches.
   * Designed to mirror Socket.io's API.
   * @example socket.onEvent('chat', (data) => console.log(data))
   */
  onEvent(eventName: string, listener: (data: any) => void): this {
    this.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString())
        if (payload && payload.event === eventName) {
          listener(payload.data)
        }
      } catch {
        // Silently ignore messages that aren't valid JSON or don't match the format
      }
    })
    return this
  }
}
