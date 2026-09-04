export * from './router/types'
export * from './config/types'
export * from './plugin/types'

// ─── Shared Server Types ────────────────────────────────────────────────────────

export interface SslConfig {
  key: string | Buffer
  cert: string | Buffer
  passphrase?: string
}

export interface ListenOptions {
  port?: number
  host?: string
  ssl?: SslConfig
  redirectHttp?: boolean | number
  onListen?: (address: { port: number; host: string }) => void
}
