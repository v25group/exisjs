import * as promClient from '@prometheus-io/client'

let isInitialized = false

export const registry = new promClient.Registry()

export const httpRequestDurationMicroseconds = new promClient.Histogram({
  name: 'exisjs_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10], // 0.1 to 10 seconds
})

export function initMetrics() {
  if (isInitialized) return
  isInitialized = true

  // Register our custom metrics
  registry.registerMetric(httpRequestDurationMicroseconds)

  // Collect Node.js default metrics (memory, event loop lag, etc.)
  promClient.collectDefaultMetrics({ register: registry })
}

export async function getMetrics(): Promise<string> {
  return await registry.metrics()
}
