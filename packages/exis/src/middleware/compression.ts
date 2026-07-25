import zlib from 'node:zlib'
import type { Handler, Request, Response } from '../types'

export function compression(): Handler {
  return (req: Request, res: Response, next) => {
    const acceptEncoding = (req.headers['accept-encoding'] as string) || ''

    // Determine encoding
    let encoding: 'br' | 'gzip' | 'deflate' | null = null
    if (acceptEncoding.includes('br')) encoding = 'br'
    else if (acceptEncoding.includes('gzip')) encoding = 'gzip'
    else if (acceptEncoding.includes('deflate')) encoding = 'deflate'

    if (!encoding || req.method === 'HEAD') {
      return next()
    }

    let stream: zlib.BrotliCompress | zlib.Gzip | zlib.Deflate | null = null

    const originalWrite = res.raw.write.bind(res.raw)
    const originalEnd = res.raw.end.bind(res.raw)
    const originalRawSetHeader = res.raw.setHeader.bind(res.raw)
    const originalRawWriteHead = res.raw.writeHead.bind(res.raw)

    res.raw.setHeader = function (
      name: string,
      value: string | number | readonly string[]
    ) {
      if (name.toLowerCase() === 'content-length') {
        return this
      }
      return originalRawSetHeader(name, value)
    }

    res.raw.writeHead = function (
      statusCode: number,
      reasonOrHeaders?: any,
      headers?: any
    ) {
      const actualHeaders = headers || reasonOrHeaders
      if (actualHeaders && typeof actualHeaders === 'object') {
        const cleaned: any = {}
        for (const [k, v] of Object.entries(actualHeaders)) {
          if (k.toLowerCase() !== 'content-length') {
            cleaned[k] = v
          }
        }
        if (headers) {
          reasonOrHeaders = cleaned
        } else {
          reasonOrHeaders = cleaned
        }
      }
      return originalRawWriteHead(statusCode, reasonOrHeaders, headers)
    }

    let onFinishCallback: (() => void) | undefined

    const startCompression = () => {
      if (stream) return // already started

      originalRawSetHeader('Content-Encoding', encoding as string)
      originalRawSetHeader('Vary', 'Accept-Encoding')
      originalRawSetHeader('Transfer-Encoding', 'chunked')

      if (encoding === 'br') {
        stream = zlib.createBrotliCompress()
      } else if (encoding === 'gzip') {
        stream = zlib.createGzip()
      } else if (encoding === 'deflate') {
        stream = zlib.createDeflate()
      }

      if (stream) {
        stream.on('data', (chunk) => {
          originalWrite(chunk)
        })
        stream.on('end', () => {
          originalEnd(undefined as any, undefined as any, onFinishCallback)
        })
      }
    }

    res.raw.write = function (
      chunk: unknown,
      encodingOrCb?: unknown,
      cb?: unknown
    ) {
      if (res.raw.writableEnded) return false
      if (!stream) startCompression()
      if (stream) {
        return stream.write(
          chunk as Uint8Array,
          encodingOrCb as BufferEncoding,
          cb as (error: Error | null | undefined) => void
        )
      }
      return originalWrite(
        chunk as Uint8Array,
        encodingOrCb as BufferEncoding,
        cb as (error: Error | null | undefined) => void
      )
    }

    let ended = false
    res.raw.end = function (
      chunk?: unknown,
      encodingOrCb?: unknown,
      cb?: unknown
    ) {
      if (res.raw.writableEnded || ended) return this
      ended = true

      let callback: (() => void) | undefined
      let encodingArg: string | undefined

      if (typeof chunk === 'function') {
        callback = chunk as () => void
        chunk = undefined
      } else if (typeof encodingOrCb === 'function') {
        callback = encodingOrCb as () => void
        encodingOrCb = undefined
      } else if (typeof cb === 'function') {
        callback = cb as () => void
      }

      if (typeof encodingOrCb === 'string') {
        encodingArg = encodingOrCb
      }

      if (callback) {
        onFinishCallback = callback
      }

      if (chunk) {
        if (!stream) startCompression()
        if (stream) {
          stream.write(chunk as Uint8Array, encodingArg as BufferEncoding)
        } else {
          originalWrite(chunk as Uint8Array, encodingArg as BufferEncoding)
        }
      }

      if (stream) {
        stream.end()
        stream = null
      } else {
        originalEnd(
          chunk as Uint8Array,
          encodingArg as BufferEncoding,
          callback
        )
      }
      return this
    }

    next()
  }
}
