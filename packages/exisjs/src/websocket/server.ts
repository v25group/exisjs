import type { ExisWebSocket } from './socket'

/**
 * Manages all active WebSocket connections and handles the pub/sub room subscriptions.
 */
export class ExisWebSocketServer {
  // Map of Room Name -> Set of subscribed ExisWebSockets
  private rooms = new Map<string, Set<ExisWebSocket>>()
  // Set of all active connections
  private clients = new Set<ExisWebSocket>()
  public presenceEnabled = false
  private pingInterval: NodeJS.Timeout | null = null

  constructor() {
    this.startHeartbeat()
  }

  /**
   * Enables automatic 'room:join' and 'room:leave' presence broadcasts
   * to all users in a room when a socket subscribes/unsubscribes.
   */
  enablePresence(): void {
    this.presenceEnabled = true
  }

  private startHeartbeat() {
    this.pingInterval = setInterval(() => {
      for (const client of this.clients) {
        if (!client.isAlive) {
          client.raw.terminate()
          this.clients.delete(client)
          continue
        }
        client.isAlive = false
        client._ping()
      }
    }, 30000)
    // Don't keep the process alive just for the heartbeat
    this.pingInterval.unref()
  }

  /**
   * Tracks a new socket connection.
   */
  track(socket: ExisWebSocket): void {
    this.clients.add(socket)
    if (socket.raw) {
      socket.raw.once('close', () => {
        this.clients.delete(socket)
      })
    }
  }

  /**
   * Subscribes a socket to a room.
   */
  subscribe(socket: ExisWebSocket, room: string): void {
    let clients = this.rooms.get(room)
    if (!clients) {
      clients = new Set()
      this.rooms.set(room, clients)
    }
    clients.add(socket)

    // Auto-unsubscribe when the socket closes
    socket.raw.once('close', () => {
      this.unsubscribe(socket, room)
    })
  }

  /**
   * Unsubscribes a socket from a room.
   */
  unsubscribe(socket: ExisWebSocket, room: string): void {
    const clients = this.rooms.get(room)
    if (clients) {
      clients.delete(socket)
      // Cleanup empty rooms to prevent memory leaks
      if (clients.size === 0) {
        this.rooms.delete(room)
      }
    }
  }

  /**
   * Publishes a message to all sockets subscribed to a room.
   * @param room The room to publish to
   * @param data The payload
   * @param exclude Optional socket to exclude from the broadcast
   */
  publish(room: string, data: unknown, exclude?: ExisWebSocket): void {
    const clients = this.rooms.get(room)
    if (!clients) return

    const payload =
      typeof data === 'object' && data !== null && !Buffer.isBuffer(data)
        ? JSON.stringify(data)
        : (data as string | Buffer | Uint8Array)

    for (const client of clients) {
      if (client === exclude) continue

      if (client.raw.readyState === 1 /* WebSocket.OPEN */) {
        client.raw.send(payload)
      }
    }
  }

  /**
   * Broadcasts a JSON event to all connected clients on this server instance.
   * @example server.emit('announcement', { msg: 'Server rebooting!' })
   */
  emit(event: string, data?: unknown): void {
    const payload = JSON.stringify({ event, data })
    for (const client of this.clients) {
      if (client.raw.readyState === 1) {
        client.raw.send(payload)
      }
    }
  }

  /**
   * Provides a chainable API to broadcast an event to all clients in a specific room.
   * @example server.to('room1').emit('chat', { message: 'hello' })
   */
  to(room: string) {
    return {
      emit: (event: string, data?: unknown) => {
        this.publish(room, { event, data })
      },
    }
  }

  /**
   * Returns a copy of the Set of active ExisWebSocket clients in a given room.
   * Useful for counting users or broadcasting to specific subsets.
   */
  getClientsInRoom(room: string): Set<ExisWebSocket> {
    const clients = this.rooms.get(room)
    return clients ? new Set(clients) : new Set()
  }

  /**
   * Returns an array of basic profile objects for everyone in the room.
   * Extracts the \`id\` and \`data\` properties from each socket.
   */
  getRoomRoster(room: string): { id: string; data: Record<string, any> }[] {
    const roster: { id: string; data: Record<string, any> }[] = []
    const clients = this.rooms.get(room)
    if (clients) {
      for (const client of clients) {
        roster.push({ id: client.id, data: client.data })
      }
    }
    return roster
  }

  /**
   * Closes all active connections and cleans up.
   */
  close(): void {
    if (this.pingInterval) clearInterval(this.pingInterval)
    for (const client of this.clients) {
      client.close(1001, 'Server shutting down')
    }
    this.rooms.clear()
    this.clients.clear()
  }
}
