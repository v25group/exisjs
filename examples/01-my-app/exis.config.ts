import { defineConfig } from 'exisjs/config'

const isProduction = process.env.NODE_ENV === 'production'

export default defineConfig({
  port: Number(process.env.PORT) || 4000,
  host: '0.0.0.0',

  // Browsers only accept credentialed requests from explicit origins, so list
  // them. With no CORS_ORIGIN set, any origin may call the API without cookies.
  cors: process.env.CORS_ORIGIN
    ? { origin: process.env.CORS_ORIGIN.split(','), credentials: true }
    : { origin: '*' },

  helmet: { enabled: true },

  // Wraps successful JSON responses as { success: true, data, timestamp }
  transformResponse: true,

  healthcheck: { enabled: true },

  // Swagger UI at /docs, OpenAPI JSON at /docs/json.
  // Use `enabled: !isProduction` to hide the docs in production.
  docs: {
    enabled: true,
    path: '/docs',
    title: '01-My-App API',
    version: '1.0.0',
    description: 'Functional ExisJS example: auth, users, posts and cron',
  },

  logger: {
    level: isProduction ? 'info' : 'debug',
    pretty: !isProduction,
  },
})
