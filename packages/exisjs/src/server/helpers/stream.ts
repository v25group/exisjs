import type { ServerResponse } from 'node:http'
import type { Request as IRequest } from '../../types'
import { logger } from '../../logger/index'

export function streamToResponse(
  resRaw: ServerResponse,
  readable: NodeJS.ReadableStream | ReadableStream | AsyncIterable<any>,
  isWritable: boolean,
  headersSent: boolean,
  hasHeader: (name: string) => boolean,
  setHeader: (name: string, val: string) => void,
  setStatusCode: (code: number) => void,
  endFn: (data?: any) => void,
  req?: IRequest
): void {
  if (!isWritable) {
    if (typeof (readable as any).destroy === 'function') {
      ;(readable as any).destroy()
    } else if (typeof (readable as any).cancel === 'function') {
      ;(readable as any).cancel().catch(() => {
        /* ignore */
      })
    }
    return
  }

  if (!hasHeader('Content-Type')) {
    setHeader('Content-Type', 'application/octet-stream')
  }

  // 1. Web Standard ReadableStream (fetch, OpenAI, Anthropic, AI SDKs)
  if (typeof (readable as any).getReader === 'function') {
    const reader = (readable as any).getReader()
    let closed = false

    const cleanup = () => {
      if (closed) return
      closed = true
      try {
        reader.cancel().catch(() => {
          /* ignore */
        })
      } catch {
        // ignore
      }
    }

    resRaw.once('close', cleanup)
    if (req && (req as any).raw) {
      ;(req as any).raw.once('close', cleanup)
      ;(req as any).raw.once('aborted', cleanup)
    }

    ;(async () => {
      try {
        while (true) {
          if (closed || resRaw.destroyed) {
            cleanup()
            break
          }
          const { done, value } = await reader.read()
          if (done) {
            resRaw.removeListener('close', cleanup)
            if (!resRaw.writableEnded && !resRaw.destroyed) {
              endFn()
            }
            break
          }
          if (value !== undefined && value !== null) {
            const ok = resRaw.write(value)
            if (!ok && !resRaw.destroyed && !resRaw.writableEnded) {
              await new Promise<void>((resolve) =>
                resRaw.once('drain', resolve)
              )
            }
          }
        }
      } catch (err: any) {
        cleanup()
        if (req && req.log) {
          req.log.error({ err }, '[ExisJS] Error in Web ReadableStream')
        } else {
          logger.error({ err }, '[ExisJS] Error in Web ReadableStream')
        }
        if (isWritable && !headersSent) {
          setStatusCode(500)
          endFn('{"error":"Stream transmission failed"}')
        } else if (!resRaw.destroyed) {
          resRaw.destroy(err)
        }
      }
    })()
    return
  }

  // 2. AsyncIterable / Generator stream
  if (
    typeof (readable as any)[Symbol.asyncIterator] === 'function' &&
    typeof (readable as any).pipe !== 'function'
  ) {
    let closed = false
    const cleanup = () => {
      closed = true
      if (typeof (readable as any).return === 'function') {
        ;(readable as any).return().catch(() => {
          /* ignore */
        })
      }
    }

    resRaw.once('close', cleanup)
    if (req && (req as any).raw) {
      ;(req as any).raw.once('close', cleanup)
    }

    ;(async () => {
      try {
        for await (const chunk of readable as AsyncIterable<any>) {
          if (closed || resRaw.destroyed) break
          if (chunk !== undefined && chunk !== null) {
            const payload =
              typeof chunk === 'string' || Buffer.isBuffer(chunk)
                ? chunk
                : JSON.stringify(chunk)
            const ok = resRaw.write(payload)
            if (!ok && !resRaw.destroyed && !resRaw.writableEnded) {
              await new Promise<void>((resolve) =>
                resRaw.once('drain', resolve)
              )
            }
          }
        }
        resRaw.removeListener('close', cleanup)
        if (!resRaw.writableEnded && !resRaw.destroyed) {
          endFn()
        }
      } catch (err: any) {
        cleanup()
        if (req && req.log) {
          req.log.error({ err }, '[ExisJS] Error in AsyncIterable stream')
        } else {
          logger.error({ err }, '[ExisJS] Error in AsyncIterable stream')
        }
        if (isWritable && !headersSent) {
          setStatusCode(500)
          endFn('{"error":"Stream transmission failed"}')
        } else if (!resRaw.destroyed) {
          resRaw.destroy(err)
        }
      }
    })()
    return
  }

  // 3. Standard Node.js Readable Stream
  const cleanup = () => {
    if (
      typeof (readable as any).destroy === 'function' &&
      !(readable as any).destroyed
    ) {
      ;(readable as any).destroy()
    }
  }

  // Auto-destroy stream if client aborts or response closes early
  resRaw.once('close', cleanup)
  if (req && (req as any).raw) {
    ;(req as any).raw.once('close', cleanup)
    ;(req as any).raw.once('aborted', cleanup)
  }

  // Handle stream error to prevent process crash
  if (typeof (readable as any).on === 'function') {
    ;(readable as any).once('error', (err: any) => {
      resRaw.removeListener('close', cleanup)
      if (req && req.log) {
        req.log.error({ err }, '[ExisJS] Error in sendStream')
      } else {
        logger.error({ err }, '[ExisJS] Error in sendStream')
      }
      if (isWritable && !headersSent) {
        setStatusCode(500)
        endFn('{"error":"Stream transmission failed"}')
      } else {
        cleanup()
        if (!resRaw.destroyed) {
          resRaw.destroy(err)
        }
      }
    })
  }

  if (typeof (readable as any).once === 'function') {
    ;(readable as any).once('end', () => {
      resRaw.removeListener('close', cleanup)
    })
  }

  ;(readable as any).pipe(resRaw as unknown as NodeJS.WritableStream)
}
