import type { ExisConfig } from 'exisjs/config'

const config: ExisConfig = {
  port: Number(process.env.PORT) || 4000,
  host: '0.0.0.0',

  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  },

  logger: {
    level: 'debug',
    pretty: process.env.NODE_ENV !== 'production',
  },

  queue: {
    driver: 'memory',
  },

  helmet: { enabled: true },

  test: {
    include: ['tests/**/*.test.ts'],
  },
}

export default config
