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
    req: Request
    res: Response
    next: NextFunction
    timer: NodeJS.Timeout
    isCancelled: boolean
  }

  const queue: QueuedRequest[] = []

  const processNext = () => {
    if (activeCount < maxConcurrent && queue.length > 0) {
      const queued = queue.shift()
      if (queued) {
        clearTimeout(queued.timer)

        // O(1) skip if the request timed out
        if (queued.isCancelled) {
          process.nextTick(processNext)
          return
        }

        activeCount++

        // Use _onFinish to decrement activeCount when done
        queued.res._onFinish.push(() => {
          activeCount--
          process.nextTick(processNext)
        })

        queued.next()
      }
    }
  }

  return (req: Request, res: Response, next: NextFunction) => {
    if (activeCount < maxConcurrent) {
      activeCount++

      res._onFinish.push(() => {
        activeCount--
        process.nextTick(processNext)
      })

      return next()
    }

    // Capacity reached, queue the request
    if (queue.length >= maxQueue) {
      // Return 503 Service Unavailable immediately
      return next(
        HttpError.serviceUnavailable(
          'Server is at capacity. Please try again later.'
        )
      )
    }

    const queuedReq: QueuedRequest = {
      req,
      res,
      next,
      timer: null as any,
      isCancelled: false,
    }

    const timeoutCallback = () => {
      queuedReq.isCancelled = true
      next(HttpError.serviceUnavailable('Request timed out in queue.'))
    }

    // Refresh timer logic
    queuedReq.timer = setTimeout(timeoutCallback, timeoutMs)
    if (queuedReq.timer.unref) {
      queuedReq.timer.unref()
    }

    queue.push(queuedReq)
  }
}
