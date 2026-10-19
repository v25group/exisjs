import type { ExisConfig } from 'exisjs/config'

const config: ExisConfig = {
  port: Number(process.env.PORT) || 4000,
  host: '0.0.0.0',

  // Browsers only accept credentialed requests from explicit origins, so list
  // them in CORS_ORIGIN (comma-separated). Without it, any origin may call
  // the API, but without cookies.
  cors: process.env.CORS_ORIGIN
    ? { origin: process.env.CORS_ORIGIN.split(','), credentials: true }
    : { origin: '*' },

  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    pretty: process.env.NODE_ENV !== 'production',
  },

  helmet: { enabled: true },
  asyncContext: true,
  compression: true,

  // Swagger UI at /docs, development only: published API docs help attackers
  docs: { enabled: process.env.NODE_ENV !== 'production' },

  // GET /_health (liveness) and GET /_ready (readiness)
  healthcheck: { enabled: true },
  // GET /metrics in Prometheus format; keep it off the public internet
  metrics: { enabled: true },
  // At most 200 requests at once; up to 100 more wait, then 503
  queue: { maxConcurrent: 200, maxQueue: 100 },

  test: {
    include: ['tests/**/*.test.ts'],
  },
}

export default config
