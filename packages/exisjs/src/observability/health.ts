import type { Handler } from '../types'

export interface HealthCheckOptions {
  /**
   * Optional custom path for the health check endpoint.
   * Default: '/health'
   */
  path?: string

  /**
   * An array of asynchronous check functions.
   * Return a string/object on success, or throw an error on failure.
   */
  checks?: {
    name: string
    check: () => Promise<unknown> | unknown
    timeoutMs?: number
  }[]
}

/**
 * Creates a health check middleware.
 * Intercepts requests to the specified path and runs all dependency checks.
 */
export function healthCheck(options: HealthCheckOptions = {}): Handler {
  const { path = '/health', checks = [] } = options

  return async (req, res, next) => {
    if (req.path !== path) {
      return next()
    }

    if (req.method !== 'GET') {
      res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' },
      })
      return
    }

    const results: Record<string, unknown> = {}
    let isHealthy = true

    const checkPromises = checks.map(
      async ({ name, check, timeoutMs = 5000 }) => {
        try {
          const timeoutPromise = new Promise((_, reject) => {
            const t = setTimeout(
              () => reject(new Error('Health check timed out')),
              timeoutMs
            )
            t.unref()
          })
          const result = await Promise.race([check(), timeoutPromise])
          results[name] = { status: 'up', result }
        } catch (err: unknown) {
          isHealthy = false
          results[name] = {
            status: 'down',
            error: err instanceof Error ? err.message : 'Unknown error',
          }
        }
      }
    )

    await Promise.all(checkPromises)

    if (isHealthy) {
      res.status(200).json({ status: 'pass', dependencies: results })
    } else {
      res.status(503).json({ status: 'fail', dependencies: results })
    }
  }
}
