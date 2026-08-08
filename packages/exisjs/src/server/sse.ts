import type { ExisResponse } from './response'

export class ExisSSE {
  private res: ExisResponse
  private isOpen = true

  constructor(res: ExisResponse) {
    this.res = res

    // 1. Set SSE standard headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    // Optional CORS/X-Accel-Buffering for nginx
    res.setHeader('X-Accel-Buffering', 'no')

    // 2. Handle client disconnects gracefully
    res.raw.on('close', () => {
      this.isOpen = false
    })
  }

  /**
   * Send a streaming event to the client
   */
  send(data: string | Record<string, any>, eventName?: string) {
    if (!this.isOpen) return

    let payload = ''

    if (eventName) {
      payload += `event: ${eventName}\n`
    }

    if (typeof data === 'object') {
      payload += `data: ${JSON.stringify(data)}\n\n`
    } else {
      payload += `data: ${data}\n\n`
    }

    this.res.raw.write(payload)
  }

  /**
   * Close the SSE connection from the server side
   */
  close() {
    if (!this.isOpen) return
    this.isOpen = false
    this.res.raw.end()
  }

  get connected() {
    return this.isOpen
  }
}
