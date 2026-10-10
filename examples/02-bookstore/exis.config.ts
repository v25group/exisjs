import type { ExisConfig } from 'exisjs/config'

const isProduction = process.env.NODE_ENV === 'production'

const config: ExisConfig = {
  port: Number(process.env.PORT) || 4000,
  host: '0.0.0.0',

  // Browsers only accept credentialed requests from explicit origins, so list
  // them. With no CORS_ORIGIN set, any origin may call the API without cookies.
  cors: process.env.CORS_ORIGIN
    ? { origin: process.env.CORS_ORIGIN.split(','), credentials: true }
    : { origin: '*' },

  helmet: { enabled: true },
  compression: true,

  // Swagger UI at /docs. Use `enabled: !isProduction` to hide it in production.
  docs: {
    enabled: true,
    title: 'Bookstore API',
    version: '1.0.0',
    description: 'Class-based ExisJS example with MongoDB',
  },

  logger: {
    level: isProduction ? 'info' : 'debug',
    pretty: !isProduction,
  },

  test: {
    include: ['tests/**/*.test.ts'],
  },
}

export default config
