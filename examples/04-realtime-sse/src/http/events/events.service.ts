import type { SSEStream } from 'exisjs/router'

// In-memory active subscriber registry
const activeClients = new Set<SSEStream>()

export function registerClient(client: SSEStream): () => void {
  activeClients.add(client)
  return () => {
    activeClients.delete(client)
  }
}

export function broadcast(event: string, data: unknown): void {
  for (const client of activeClients) {
    client.send({ event, data })
  }
}

export function getActiveCount(): number {
  return activeClients.size
}
