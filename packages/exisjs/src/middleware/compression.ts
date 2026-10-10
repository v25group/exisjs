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
 * is our own per-request object, modifying it doesn't deoptimize Node internals.
 */
// Brotli's default quality (11) costs tens of ms per 100 KB; 4 compresses
// close to gzip -9 at a fraction of the CPU, the usual choice for dynamic
// responses
const BROTLI_OPTIONS: zlib.BrotliOptions = {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
  },
}
const GZIP_OPTIONS: zlib.ZlibOptions = { level: 6 }

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
    // Compression is async, so a second end() could arrive before the first
    // finishes; only the first one counts
    let ending = false
    res.end = function (data?: unknown) {
      if (ending || (res.raw as any).writableEnded) return
      ending = true

      // Already encoded by the handler, or explicitly marked untransformable
      const cacheControl = String(res.raw.getHeader('Cache-Control') || '')
      if (
        res.raw.getHeader('Content-Encoding') ||
        cacheControl.includes('no-transform')
      ) {
        originalEnd(data)
        return
      }

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
      res.vary('Accept-Encoding')
      // Remove Content-Length since compressed size will differ
      res.raw.removeHeader('Content-Length')

      // zlib's async API runs on the libuv threadpool, so a large body does
      // not block other requests while it compresses
      const finish = (err: Error | null, compressed: Buffer) => {
        if (err || (res.raw as any).writableEnded || res.raw.destroyed) {
          if (err && !(res.raw as any).headersSent) {
            res.raw.removeHeader('Content-Encoding')
            originalEnd(data)
          }
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
            ;(res as any)._markDone?.()
          })
        } else {
          res.raw.end(compressed)
          ;(res as any)._markDone?.()
        }
      }

      if (selectedEncoding === 'br') {
        zlib.brotliCompress(buf, BROTLI_OPTIONS, finish)
      } else if (selectedEncoding === 'gzip') {
        zlib.gzip(buf, GZIP_OPTIONS, finish)
      } else {
        zlib.deflate(buf, GZIP_OPTIONS, finish)
      }
    }

    next()
  }
}
