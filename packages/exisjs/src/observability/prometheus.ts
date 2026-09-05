import type { Handler } from '../types'

export interface HttpMetricsAdapter {
  /**
   * Called when a request starts. Can be used to track active/inflight requests.
   * Return a function to be called when the request finishes, useful for measuring duration.
   */
  onRequestStart?: (metadata: {
    method: string
    path: string
  }) => (responseMetadata: { statusCode: number; durationMs: number }) => void

  /**
   * Called when a request finishes.
   */
  onRequestEnd?: (metadata: {
    method: string
    path: string
    statusCode: number
    durationMs: number
  }) => void
}

/**
 * Creates a metrics collection middleware.
 * Exis uses a 'Bring Your Own Metrics' approach to stay dependency-free.
 * You can pass adapters for @prometheus-io/client, statsd, or any custom tracking.
 */
export function metrics(adapter: HttpMetricsAdapter): Handler {
  return (req, res, next) => {
    const start = Date.now()

    // Normalize path to prevent cardinality explosion in metrics (e.g., turn /users/123 to /users/:id)
    // Exis Router automatically sets `req.routePath` if matched, else fallback to raw path
    const pathLabel =
      (req as unknown as { routePath?: string }).routePath || req.path
    const method = req.method

    const endTracker = adapter.onRequestStart?.({ method, path: pathLabel })

    res.raw.once('finish', () => {
      const duration = Date.now() - start
      const statusCode = res.statusCode

      endTracker?.({ statusCode, durationMs: duration })

      adapter.onRequestEnd?.({
        method,
        path: pathLabel,
        statusCode,
        durationMs: duration,
      })
    })

    next()
  }
}
