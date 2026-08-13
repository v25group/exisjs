import type { Handler, Request, Response, NextFunction } from '../types'

export interface DedupeOptions {
  /**
   * Function to generate a unique key for the request.
   * MUST be provided to prevent cross-user data leaks.
   */
  keyGenerator: (req: Request) => string
}

/**
 * Request Deduplication Middleware
 *
 * Prevents identical parallel requests (e.g., from a user double-clicking a button)
 * from hitting the controller simultaneously. The first request runs the handler,
 * while subsequent requests for the same key wait and share the same response.
 *
 * @example
 * // in gateway.ts
 * dedupe({ keyGenerator: (req) => req.user?.id || req.ip })
 */
export function dedupeMiddleware(options: DedupeOptions): Handler {
  if (!options || typeof options.keyGenerator !== 'function') {
    throw new Error(
      `dedupeMiddleware: keyGenerator option is required to prevent cross-user data leaks.\nExample: dedupe({ keyGenerator: (req) => req.user?.id || req.ip })`
    )
  }
  const keyGenerator = options.keyGenerator

  // Stores pending requests: Map of key -> Array of { res, next } waiting for the result
  const pendingRequests = new Map<
    string,
    { res: Response; next: NextFunction }[]
  >()

  return (req: Request, res: Response, next: NextFunction) => {
    // Usually only dedupe GET requests to avoid side effects running multiple times when they shouldn't
    if (req.method !== 'GET') {
      return next()
    }

    const key = keyGenerator(req)

    const pending = pendingRequests.get(key)
    if (pending) {
      // This request is already in flight. Queue it.
      pending.push({ res, next })
      return
    }

    // First request for this key, mark as in flight
    pendingRequests.set(key, [])

    // Intercept send/json so we can broadcast the result to all waiting requests
    const originalSend = res.send.bind(res)
    const originalJson = res.json.bind(res)

    let broadcasted = false

    const broadcast = (body: string | Buffer) => {
      if (broadcasted) return
      broadcasted = true

      const waiting = pendingRequests.get(key)
      pendingRequests.delete(key) // Clear from in-flight immediately

      if (waiting && waiting.length > 0) {
        // Get headers from this response to copy to others
        const contentType =
          typeof (res as unknown as { getHeader?: (name: string) => string })
            .getHeader === 'function'
            ? (
                res as unknown as { getHeader: (name: string) => string }
              ).getHeader('content-type')
            : undefined
        const statusCode = res.statusCode

        for (const { res: waitingRes } of waiting) {
          waitingRes.status(statusCode)
          if (contentType) {
            waitingRes.set('Content-Type', contentType)
          }
          // We can just use the underlying .send() on the waiting response
          // waitingRes.send() handles string | Buffer correctly.
          // Even if it was a JSON response originally, it's already serialized here.
          waitingRes.send(body)
        }
      }
    }

    res.send = function (body: string | Buffer) {
      broadcast(body)
      return originalSend(body)
    }

    res.json = function (data: unknown) {
      // JSON.stringify once for the broadcast
      const strBody = JSON.stringify(data)
      broadcast(strBody)
      return originalJson(data)
    }

    // Intercept errors (if the route throws, we need to release waiting requests)
    const originalNext = next
    const wrappedNext: NextFunction = (err?: Error) => {
      if (err && !broadcasted) {
        broadcasted = true
        const waiting = pendingRequests.get(key)
        pendingRequests.delete(key)

        if (waiting) {
          for (const { next: waitingNext } of waiting) {
            waitingNext(err)
          }
        }
      }
      return originalNext(err)
    }

    wrappedNext()
  }
}
