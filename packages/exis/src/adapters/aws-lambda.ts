import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import type { App } from '../server/app'

export interface APIGatewayEvent {
  httpMethod: string
  path: string
  headers: Record<string, string | undefined>
  body: string | null
  isBase64Encoded: boolean
  queryStringParameters?: Record<string, string | undefined>
}

export interface APIGatewayResult {
  statusCode: number
  headers: Record<string, string>
  body: string
  isBase64Encoded: boolean
}

/**
 * Creates an AWS Lambda handler for an Exis App.
 * Converts API Gateway events to native Node.js HTTP streams.
 */
export function aws(app: App) {
  let initialized = false

  return async (event: APIGatewayEvent): Promise<APIGatewayResult> => {
    if (!initialized) {
      if (typeof app.create === 'function') await app.create()
      if (typeof app.onStartHook === 'function') await app.onStartHook(app)
      initialized = true
    }

    return new Promise((resolve) => {
      const socket = new Socket()
      const req = new IncomingMessage(socket)
      const res = new ServerResponse(req)

      // Map Method and URL
      req.method = event.httpMethod

      let queryStr = ''
      if (event.queryStringParameters) {
        const params = new URLSearchParams()
        for (const [k, v] of Object.entries(event.queryStringParameters)) {
          if (v) params.append(k, v)
        }
        const qs = params.toString()
        if (qs) queryStr = `?${qs}`
      }
      req.url = `${event.path}${queryStr}`

      // Map Headers
      const reqHeaders: Record<string, string> = {}
      if (event.headers) {
        for (const [k, v] of Object.entries(event.headers)) {
          if (v !== undefined) {
            reqHeaders[k.toLowerCase()] = v
          }
        }
      }
      req.headers = reqHeaders

      // Mock Response Streams
      const bodyChunks: Buffer[] = []
      let statusCode = 200
      const resHeaders: Record<string, string> = {}

      const originalSetHeader = res.setHeader.bind(res)
      res.setHeader = (name: string, value: string | string[] | number) => {
        resHeaders[name.toLowerCase()] = String(value)
        return originalSetHeader(name, value)
      }

      const originalWriteHead = res.writeHead.bind(res)

      res.writeHead = (...args: any[]) => {
        statusCode = args[0]
        const headers = typeof args[1] !== 'string' ? args[1] : args[2]
        if (headers) {
          for (const [k, v] of Object.entries(headers)) {
            resHeaders[k.toLowerCase()] = String(v)
          }
        }
        return originalWriteHead(
          ...(args as Parameters<typeof originalWriteHead>)
        )
      }

      res.write = (...args: any[]) => {
        const chunk = args[0]
        const encoding = typeof args[1] === 'string' ? args[1] : 'utf8'
        const cb = typeof args[1] === 'function' ? args[1] : args[2]

        if (chunk) {
          bodyChunks.push(
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk as string, encoding as BufferEncoding)
          )
        }
        if (typeof cb === 'function') cb()
        return true
      }

      const originalEnd = res.end.bind(res)

      res.end = (...args: any[]) => {
        const chunk = typeof args[0] !== 'function' ? args[0] : undefined
        const encoding = typeof args[1] === 'string' ? args[1] : 'utf8'
        const cb =
          typeof args[args.length - 1] === 'function'
            ? args[args.length - 1]
            : undefined

        if (chunk) {
          bodyChunks.push(
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk as string, encoding as BufferEncoding)
          )
        }

        const finalBuffer = Buffer.concat(bodyChunks)
        statusCode = res.statusCode || statusCode

        // Resolve the Lambda promise
        resolve({
          statusCode,
          headers: resHeaders,
          body: finalBuffer.toString('base64'),
          isBase64Encoded: true,
        })

        if (typeof cb === 'function') cb()

        return originalEnd()
      }

      // Kick off the request handling
      app.handle(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse
      )

      // Push the body into the readable stream
      if (event.body) {
        req.push(
          event.isBase64Encoded
            ? Buffer.from(event.body, 'base64')
            : Buffer.from(event.body)
        )
      }
      req.push(null)
    })
  }
}
