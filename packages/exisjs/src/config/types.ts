import type { ExisPlugin } from '../plugin/types'
import type { SslConfig } from '../types'

// ─── Config Types ─────────────────────────────────────────────────────────────

export interface CorsConfig {
  origin?: string | string[] | RegExp | RegExp[] | ((origin: string) => boolean)
  methods?: string[]
  allowedHeaders?: string[]
  exposedHeaders?: string[]
  credentials?: boolean
  maxAge?: number
  preflightContinue?: boolean
}

export interface LoggerConfig {
  level?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  pretty?: boolean
  redact?: string[]
}

// ─── Logger Types ─────────────────────────────────────────────────────────────

export interface LogFn {
  (msg: string, ...args: unknown[]): void
  (obj: Record<string, unknown>, msg?: string, ...args: unknown[]): void
}

export interface Logger {
  fatal: LogFn
  error: LogFn
  warn: LogFn
  info: LogFn
  debug: LogFn
  trace: LogFn
  silent: LogFn
  child(bindings: Record<string, unknown>): Logger
  level: string
}

export interface HelmetConfig {
  enabled?: boolean
  contentSecurityPolicy?: boolean
  xFrameOptions?: 'DENY' | 'SAMEORIGIN'
}

export interface KeepAliveConfig {
  timeoutMs?: number
  headersTimeoutMs?: number
  maxRequests?: number
}

export interface TelemetryConfig {
  enabled: boolean
  serviceName?: string
  exporter?: 'otlp' | 'console'
  endpoint?: string
}

export interface MetricsConfig {
  enabled: boolean
  path?: string // default '/metrics'
}

export interface HealthCheckConfig {
  enabled: boolean
  path?: string // default '/_health'
  checks?: (() => Promise<boolean>)[]
}

export interface ExisConfig {
  port?: number
  host?: string
  cors?: CorsConfig | boolean
  logger?: LoggerConfig | boolean
  telemetry?: TelemetryConfig | boolean
  metrics?: MetricsConfig | boolean
  healthcheck?: HealthCheckConfig | boolean
  helmet?: HelmetConfig | boolean
  trustProxy?: boolean | number
  bodyLimit?: number // bytes, default 1mb
  env?: 'development' | 'production' | 'test'
  compression?: boolean
  keepAlive?: KeepAliveConfig | boolean
  ssl?: SslConfig
  http2?: boolean // Default true when SSL is provided
  redirectHttp?: boolean | number // If true, redirects port 80 to HTTPS port. If number, redirects that specific port.
  etag?: boolean // Default false. Set to true to enable ETag generation for all responses.
  workers?: number | 'safe' | 'max' // @deprecated Use cluster.workers instead
  cluster?: {
    workers?: number | 'auto' | 'safe' | 'max' // Number of CPU workers for cluster. 'auto' or 'max' uses all cores.
  }
  debugRouting?: boolean // Enables detailed logging of the resolved route file and applied gateways for every incoming request
  asyncContext?: boolean // Enables AsyncLocalStorage for global getContext() (adds ~10% overhead). Default false.
  /**
   * Defines the HTTP server backend.
   * 'node' uses the native Node.js HTTP module.
   * 'bun' uses Bun's native HTTP module for significantly higher throughput.
   * 'auto' will use Bun if detected, otherwise Node.
   */
  server?: 'auto' | 'node' | 'bun' | 'uws'
  queue?: import('../queue/types').QueueConfig
  plugins?: ExisPlugin[]
  test?: {
    include?: string[]
    exclude?: string[]
    setupFiles?: string[]
    concurrency?: boolean | number
    coverage?: boolean
  }
}
