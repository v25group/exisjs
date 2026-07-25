import type { ExisConfig } from 'exisjs/config'
import { env } from './env'

const config: ExisConfig = {
  port: Number(env.PORT) || 4000,
  host: '0.0.0.0',

  cors: {
    origin: env.CORS_ORIGIN || '*',
    credentials: true,
  },

  logger: {
    level: 'info',
    pretty: env.NODE_ENV !== 'production',
  },

  helmet: { enabled: true },
}

export default config
