import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { ExisRequest } from '../server/request'
import { ExisResponse } from '../server/response'
import type { Request, Response, Logger } from '../types'

// ─── Mock Request ────────────────────────────────────────────────────────────

export interface MockRequestOptions {
  method?: string
  url?: string
  headers?: Record<string, string | string[]>
  socket?: Partial<Socket>
}

export function createMockRequest(options: MockRequestOptions = {}): Request {
  const {
    method = 'GET',
    url = '/',
    headers = {},
    socket: socketOpts = {},
  } = options

  const socket = new Socket()
  Object.defineProperty(socket, 'remoteAddress', {
    value: (socketOpts as Record<string, unknown>).remoteAddress ?? '127.0.0.1',
    writable: true,
    configurable: true,
  })

  const raw = new IncomingMessage(socket)
  raw.method = method
  raw.url = url

  // Assign headers
  const normalizedHeaders: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(headers)) {
    normalizedHeaders[key.toLowerCase()] = value
  }
  raw.headers = normalizedHeaders as IncomingMessage['headers']

  const res = new ExisResponse(new ServerResponse(raw))
  const req = new ExisRequest(raw, res)

  // Attach a silent logger by default for tests
  req.log = createMockLogger()

  return req
}

// ─── Mock Response ───────────────────────────────────────────────────────────

export interface MockResponse extends Response {
  _body: string
  _headers: Record<string, string | string[]>
  _statusCode: number
  _ended: boolean
}

export function createMockResponse(): MockResponse {
  const socket = new Socket()
  const raw = new ServerResponse(new IncomingMessage(socket))

  const res = new ExisResponse(raw) as MockResponse

  // Track state for assertions
  res._body = ''
  res._headers = {}
  res._statusCode = 200
  res._ended = false

  // Override end to capture output instead of writing to socket
  const originalEnd = res.end.bind(res)
  res.end = function (...args: unknown[]) {
    res._ended = true
    const chunk = args[0]
    if (chunk) {
      if (Buffer.isBuffer(chunk)) {
        res._body = chunk.toString('utf8')
      } else if (typeof chunk === 'string') {
        res._body = chunk
      }
    }
    res._statusCode = res.statusCode
    // Still call original to set headersSent
    const result = originalEnd(...(args as Parameters<typeof originalEnd>))
    res.raw.emit('finish')
    return result
  }

  // Override setHeader to track headers
  const originalSetHeader = res.setHeader.bind(res)
  res.setHeader = function (name: string, value: string | string[] | number) {
    res._headers[name.toLowerCase()] = String(value)
    return originalSetHeader(name, value)
  }

  const originalRawSetHeader = res.raw.setHeader.bind(res.raw)
  res.raw.setHeader = function (
    name: string,
    value: string | string[] | number
  ) {
    res._headers[name.toLowerCase()] = String(value)
    return originalRawSetHeader(name, value)
  }

  return res
}

// ─── Mock Logger ─────────────────────────────────────────────────────────────

export function createMockLogger(): Logger {
  const noop = () => {
    /* noop */
  }

  const logger: Logger = {
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    silent: noop,
    level: 'silent',
    child: () => createMockLogger(),
  }

  return logger
}

// ─── Mock Next Function ──────────────────────────────────────────────────────

export function createMockNext() {
  const fn = (...args: unknown[]) => {
    fn.called = true
    fn.args = args
  }
  fn.called = false
  fn.args = [] as unknown[]
  return fn
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getResponseBody(res: MockResponse): unknown {
  try {
    return JSON.parse(res._body)
  } catch {
    return res._body
  }
}

export function getResponseHeader(
  res: MockResponse,
  name: string
): string | string[] | undefined {
  return res._headers[name.toLowerCase()]
}
