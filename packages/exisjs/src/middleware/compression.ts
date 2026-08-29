import zlib from 'node:zlib'
import type { Handler, Request, Response } from '../types'

/**
 * Compression middleware — optimized to avoid monkey-patching ServerResponse methods.
 *
 * Previous implementation replaced res.raw.write/end/setHeader/writeHead with new closures
 * on every request, which:
 * 1. Created 5+ closure objects per request (GC pressure)
 * 2. Destroyed V8's hidden class optimization for ServerResponse
 *
 * This version hooks into the ExisResponse's _onFinish callback and overrides the
 * high-level json()/send()/end() methods on ExisResponse instead. Since ExisResponse
 * is our own object (and already pooled), modifying it doesn't deoptimize Node internals.
 */
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

    // Store originals from the ExisResponse wrapper (our own object — safe to override)
    const originalEnd = res.end.bind(res)
    const selectedEncoding = encoding

    // Override ExisResponse.end() to compress the final payload in a single pass.
    // This avoids touching ServerResponse's hidden class entirely.
    res.end = function (data?: unknown) {
      if ((res.raw as any).writableEnded) return

      // Skip compression for empty responses
      if (!data) {
        originalEnd(data)
        return
      }

      const buf =
        typeof data === 'string'
          ? Buffer.from(data, 'utf8')
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(String(data), 'utf8')

      // For small payloads (< 1KB), compression overhead outweighs savings
      if (buf.length < 1024) {
        originalEnd(data)
        return
      }

      // Set encoding headers
      res.raw.setHeader('Content-Encoding', selectedEncoding)
      res.raw.setHeader('Vary', 'Accept-Encoding')
      // Remove Content-Length since compressed size will differ
      res.raw.removeHeader('Content-Length')

      // Compress synchronously for small-to-medium payloads to avoid extra async overhead
      let compressed: Buffer
      try {
        if (selectedEncoding === 'br') {
          compressed = zlib.brotliCompressSync(buf)
        } else if (selectedEncoding === 'gzip') {
          compressed = zlib.gzipSync(buf)
        } else {
          compressed = zlib.deflateSync(buf)
        }
      } catch {
        // If compression fails, send uncompressed
        originalEnd(data)
        return
      }

      res.raw.setHeader('Content-Length', compressed.length)

      // Fire _onFinish callbacks via the original end path
      if (res._onFinish.length > 0) {
        res.raw.end(compressed, () => {
          // eslint-disable-next-line @typescript-eslint/prefer-for-of
          for (let i = 0; i < res._onFinish.length; i++) {
            res._onFinish[i]()
          }
        })
      } else {
        res.raw.end(compressed)
      }
    }

    next()
  }
}
