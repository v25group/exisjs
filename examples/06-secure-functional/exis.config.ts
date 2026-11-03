import fs from 'node:fs'
import type { ExisConfig } from 'exisjs/config'

const config: ExisConfig = {
  port: Number(process.env.PORT) || 4000,
  host: '127.0.0.1',
  // EXIS_SERVER=uws or bun runs the same app on that engine
  server: (process.env.EXIS_SERVER ?? 'node') as 'node' | 'uws' | 'bun',
  authorization: { defaultPolicy: 'authenticated' },
  helmet: { enabled: true },
  compression: true,
  healthcheck: { enabled: true },
  logger: { level: (process.env.LOG_LEVEL ?? 'warn') as 'warn' },
  bodyLimit: 1024 * 1024,

  // Switched on by scripts/security/attack-extra.mjs
  docs: { enabled: process.env.EXIS_DOCS === '1' },
  metrics: { enabled: process.env.EXIS_METRICS === '1' },
  ...(process.env.EXIS_WORKERS
    ? { cluster: { workers: Number(process.env.EXIS_WORKERS) } }
    : {}),
  ...(process.env.KEEP_ALIVE_MS
    ? { keepAlive: { timeoutMs: Number(process.env.KEEP_ALIVE_MS) } }
    : {}),
  ...(process.env.TLS_KEY && process.env.TLS_CERT
    ? {
        ssl: {
          key: fs.readFileSync(process.env.TLS_KEY),
          cert: fs.readFileSync(process.env.TLS_CERT),
        },
      }
    : {}),
}

export default config
