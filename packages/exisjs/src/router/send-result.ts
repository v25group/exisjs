import type { Response } from '../types'
import { SSEStream } from '../server/sse'
import { DownloadResponse } from '../server/download'
import { ExisResponse } from '../server/response'

function isStreamLike(val: any): boolean {
  return (
    typeof val.pipe === 'function' ||
    (typeof val.getReader === 'function' && typeof val.tee === 'function') ||
    (typeof val[Symbol.asyncIterator] === 'function' && !Array.isArray(val))
  )
}

/** True once the response has been sent, or is being sent asynchronously. */
export function isResponseStarted(res: Response): boolean {
  return (
    res.headersSent ||
    (res.raw as any)?.writableEnded === true ||
    (res as any)._pending === true
  )
}

/**
 * Sends what a handler returned. Shared by functional routes, file routes and
 * class controllers so every paradigm answers the same way:
 *
 * - `undefined`, or the response object itself: nothing (the handler sent it)
 * - `download(...)` result: attachment
 * - Buffer / Uint8Array: `application/octet-stream`
 * - stream / async iterable: streamed
 * - string: `text/plain`
 * - anything else, including `null`, numbers and booleans: JSON
 */
export function sendResult(result: unknown, res: Response): void {
  if (
    result === undefined ||
    result instanceof ExisResponse ||
    result === res ||
    result === res.raw ||
    result instanceof SSEStream ||
    isResponseStarted(res)
  ) {
    return
  }
  if (result instanceof DownloadResponse) {
    res.download(result.data, result.filename, result.options)
  } else if (Buffer.isBuffer(result)) {
    res.send(result)
  } else if (result instanceof Uint8Array) {
    res.send(Buffer.from(result.buffer, result.byteOffset, result.byteLength))
  } else if (typeof result === 'string') {
    res.send(result)
  } else if (
    result !== null &&
    typeof result === 'object' &&
    isStreamLike(result)
  ) {
    ;(res as any).sendStream(result)
  } else {
    res.json(result)
  }
}

/**
 * Answers a request whose handler settled without sending anything, so the
 * connection is never left open: 204, or the status the handler set
 * (for example `@HttpCode(202)`) with an empty body.
 */
export function answerIfUnsent(res: Response): void {
  if (isResponseStarted(res)) return
  if (res.statusCode === 200) res.statusCode = 204
  res.end()
}

/** A rejection with `null` or `undefined` is still a server error, not "no route". */
export function toError(err: unknown): any {
  return err === null || err === undefined
    ? new Error(`Handler rejected with ${String(err)}`)
    : err
}
