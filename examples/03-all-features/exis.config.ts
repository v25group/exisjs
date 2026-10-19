import type { ExisConfig } from 'exisjs/config'
import { configureLogger } from 'exisjs/logger'

// ─── Configure Logger (once, before anything else) ────────────────────────────
// Every `logger.info()` across the entire app picks up these settings.
configureLogger({
  level: 'debug',
  pretty: process.env.NODE_ENV !== 'production',
  redact: ['*.apiKey', '*.creditCard'], // merged with built-in defaults
})

const config: ExisConfig = {
  port: Number(process.env.PORT) || 5000,
  host: '0.0.0.0',

  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  },

  helmet: { enabled: true },
  asyncContext: true,

  // At most 500 requests at once; up to 200 more wait (10 s), the rest get 503
  queue: {
    maxConcurrent: 500,
    maxQueue: 200,
  },
}

export default config
