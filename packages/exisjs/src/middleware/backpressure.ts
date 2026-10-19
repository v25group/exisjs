import type { Handler, Request, Response, NextFunction } from '../types'
import { HttpError } from '../error/errors'

export interface BackpressureOptions {
  /** Maximum number of concurrent requests being processed */
  maxConcurrent?: number
  /** Maximum number of requests to queue when maxConcurrent is reached */
  maxQueue?: number
  /** How long to wait in the queue before timing out (ms) */
  timeoutMs?: number
}

export function backpressureMiddleware(
  options: BackpressureOptions = {}
): Handler {
  const maxConcurrent = options.maxConcurrent ?? 1000
  const maxQueue = options.maxQueue ?? 500
  const timeoutMs = options.timeoutMs ?? 10000

  let activeCount = 0

  interface QueuedRequest {
    res: Response
    next: NextFunction
    timer: NodeJS.Timeout
    isCancelled: boolean
  }

  const queue: QueuedRequest[] = []

  // 'close' fires once for every response: finished, streamed or aborted.
  // Counting on res.end() alone leaked a slot for each of the other two.
  const start = (res: Response, next: NextFunction) => {
    activeCount++
    res.raw.once('close', () => {
      activeCount--
      process.nextTick(processNext)
    })
    next()
  }

  const processNext = () => {
    while (activeCount < maxConcurrent && queue.length > 0) {
      const queued = queue.shift()!
      clearTimeout(queued.timer)
      if (queued.isCancelled) continue
      start(queued.res, queued.next)
    }
  }

  return (req: Request, res: Response, next: NextFunction) => {
    if (activeCount < maxConcurrent) return start(res, next)

    // Capacity reached, queue the request
    if (queue.length >= maxQueue) {
      return next(
        HttpError.serviceUnavailable(
          'Server is at capacity. Please try again later.'
        )
      )
    }

    const queuedReq: QueuedRequest = {
      res,
      next,
      timer: setTimeout(() => {
        queuedReq.isCancelled = true
        next(HttpError.serviceUnavailable('Request timed out in queue.'))
      }, timeoutMs),
      isCancelled: false,
    }
    queuedReq.timer.unref?.()
    // A client that gives up while waiting frees its place in the queue
    res.raw.once('close', () => {
      if (!queuedReq.isCancelled) {
        queuedReq.isCancelled = true
        clearTimeout(queuedReq.timer)
      }
    })
    queue.push(queuedReq)
  }
}

const QUEUE_KEYS = ['driver', 'maxConcurrent', 'maxQueue', 'timeoutMs']

/**
 * Checks the `queue` config and returns the backpressure options it asks
 * for. Throws at start-up on anything the framework would otherwise ignore.
 */
export function resolveQueueConfig(
  queue: unknown
): BackpressureOptions | undefined {
  if (queue === undefined || queue === null || queue === false) return undefined
  if (typeof queue !== 'object' || Array.isArray(queue)) {
    throw new TypeError(
      `[ExisJS Config] queue must be an object, got ${Array.isArray(queue) ? 'an array' : typeof queue}`
    )
  }
  const q = queue as Record<string, unknown>
  for (const key of Object.keys(q)) {
    if (!QUEUE_KEYS.includes(key)) {
      throw new TypeError(
        `[ExisJS Config] Unknown option queue.${key}. Supported: ${QUEUE_KEYS.join(', ')}`
      )
    }
  }
  if (q.driver !== undefined && q.driver !== 'memory') {
    throw new TypeError(
      `[ExisJS Config] queue.driver "${String(q.driver)}" is not supported. ` +
        'The only driver is "memory": requests over queue.maxConcurrent wait ' +
        'in this process and are lost if it stops. Remove queue.driver, or ' +
        'set it to "memory".'
    )
  }
  for (const key of ['maxConcurrent', 'maxQueue', 'timeoutMs'] as const) {
    const v = q[key]
    const min = key === 'maxQueue' ? 0 : 1
    if (v !== undefined && !(Number.isInteger(v) && (v as number) >= min)) {
      throw new TypeError(
        `[ExisJS Config] queue.${key} must be an integer >= ${min}, got ${JSON.stringify(v)}`
      )
    }
  }
  return {
    maxConcurrent: q.maxConcurrent as number | undefined,
    maxQueue: q.maxQueue as number | undefined,
    timeoutMs: q.timeoutMs as number | undefined,
  }
}
