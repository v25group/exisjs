import type { Handler } from '../types'

export interface TraceSpan {
  setAttribute(key: string, value: string | number | boolean): void
  setStatus(status: { code: number; message?: string }): void
  recordException(exception: Error): void
  end(): void
}

export interface TracingAdapter {
  /**
   * Start an active span for the given request.
   * Exis will automatically end the span when the response is sent.
   */
  startActiveSpan(
    name: string,
    metadata: {
      method: string
      path: string
      headers: Record<string, string | string[] | undefined>
    },
    callback: (span: TraceSpan) => void
  ): void
}

/**
 * Creates an OpenTelemetry-compatible tracing middleware.
 * Uses a 'Bring Your Own Tracer' approach.
 */
export function tracing(adapter: TracingAdapter): Handler {
  return (req, res, next) => {
    const pathLabel =
      (req as unknown as { routePath?: string }).routePath || req.path
    const spanName = `${req.method} ${pathLabel}`

    // Scrub sensitive headers before sending to external observability platforms
    const safeHeaders = { ...req.headers }
    const sensitiveKeys = [
      'authorization',
      'cookie',
      'set-cookie',
      'x-api-key',
      'session',
    ]
    for (const key of sensitiveKeys) {
      if (safeHeaders[key]) {
        safeHeaders[key] = '[REDACTED]'
      }
    }

    adapter.startActiveSpan(
      spanName,
      { method: req.method, path: req.path, headers: safeHeaders },
      (span) => {
        // Automatically inject trace ID into request logger if it exists
        // (Assuming the user implements this in the adapter by patching req.log,
        // or we let OpenTelemetry auto-instrument pino).

        res.raw.once('finish', () => {
          const statusCode = res.statusCode

          span.setAttribute('http.status_code', statusCode)

          if (statusCode >= 500) {
            span.setStatus({ code: 2 }) // OpenTelemetry SpanStatusCode.ERROR = 2
          } else {
            span.setStatus({ code: 1 }) // OpenTelemetry SpanStatusCode.OK = 1
          }

          span.end()
        })

        next()
      }
    )
  }
}
