import type { ExisPlugin, ExisPluginInstance } from '../plugin/types'
import type { SslConfig } from '../types'

// ─── Config Types ─────────────────────────────────────────────────────────────

export type CorsOriginCallback = (err: Error | null, allow?: boolean) => void

export type CorsOriginFn = (
  origin: string,
  callback?: CorsOriginCallback
) => boolean | Promise<boolean> | void

export interface CorsConfig {
  origin?: boolean | string | RegExp | (string | RegExp)[] | CorsOriginFn
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
  /** `true` applies a strict default policy; a string is used verbatim (may contain `{nonce}`) */
  contentSecurityPolicy?: boolean | string
  xFrameOptions?: 'DENY' | 'SAMEORIGIN'
  hsts?: boolean | { maxAge: number; includeSubDomains: boolean }
  noSniff?: boolean
  xssFilter?: boolean
  hidePoweredBy?: boolean
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

import type { SwaggerConfig } from '../swagger/types'

export type { SwaggerConfig } from '../swagger/types'

export interface WatchConfig {
  /** Directories or files to watch for hot reloads (e.g. ['src', '.env']) */
  paths?: string[]
  /** Additional files, directories, or regex patterns to ignore */
  ignore?: (string | RegExp)[]
  /** Explicit allowed file extensions that trigger reloads (defaults to ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) */
  extensions?: string[]
  /** Debounce interval in milliseconds before reloading the server (default: 250ms) */
  debounceMs?: number
}

export interface DevConfig {
  /** Directories or files to watch during development */
  watch?: string[]
  /** Additional files, directories, or regex patterns to ignore */
  ignored?: (string | RegExp)[]
  /** Enables filesystem polling for cross-platform/Windows NTFS reliability */
  usePolling?: boolean
  /** Polling interval in milliseconds */
  interval?: number
  /** Polling binary interval in milliseconds */
  binaryInterval?: number
  /** Explicit allowed file extensions that trigger reloads */
  extensions?: string[]
  /** Debounce interval in milliseconds before reloading the server */
  debounceMs?: number
}

export interface ExisConfig {
  port?: number
  host?: string
  cors?: CorsConfig | boolean
  logger?: LoggerConfig | boolean
  telemetry?: TelemetryConfig | boolean
  metrics?: MetricsConfig | boolean
  healthcheck?: HealthCheckConfig | boolean
  docs?: SwaggerConfig | boolean
  swagger?: SwaggerConfig | boolean
  helmet?: HelmetConfig | boolean
  trustProxy?: boolean | number
  bodyLimit?: number // bytes, default 10mb
  env?: 'development' | 'production' | 'test'
  compression?: boolean
  blockProbes?: boolean | import('../middleware/security').BlockProbesOptions
  blockSuspiciousProbes?:
    boolean | import('../middleware/security').BlockProbesOptions
  keepAlive?: KeepAliveConfig | boolean
  ssl?: SslConfig
  http2?: boolean // Default true when SSL is provided
  redirectHttp?: boolean | number // If true, redirects port 80 to HTTPS port. If number, redirects that specific port.
  etag?: boolean // Default false. Set to true to enable ETag generation for all responses.
  workers?: number | 'safe' | 'max' // @deprecated Use cluster.workers instead
  cluster?: {
    workers?: number | 'auto' | 'safe' | 'max' // Number of CPU workers for cluster. 'auto' or 'max' uses all cores.
  }
  debugRouting?: boolean // Enables detailed logging of the resolved route file and applied boundaries for every incoming request
  asyncContext?: boolean // Enables AsyncLocalStorage for global getContext() (adds ~10% overhead). Default false.
  transformResponse?: boolean | ((data: any, req: any, res: any) => any) // Optional global envelope format (e.g. { success: true, data, timestamp })
  /**
   * Defines the HTTP server backend.
   * 'node' uses the native Node.js HTTP module.
   * 'bun' uses Bun's native HTTP module for significantly higher throughput.
   * 'auto' will use Bun if detected, otherwise Node.
   */
  server?: 'auto' | 'node' | 'bun' | 'uws'

  queue?: {
    driver?: 'memory' | 'redis' | string
    maxConcurrent?: number
    maxQueue?: number
    [key: string]: any
  }
  watch?: WatchConfig
  dev?: DevConfig
  plugins?: (ExisPlugin | ExisPluginInstance)[]
  test?: {
    include?: string[]
    exclude?: string[]
    setupFiles?: string[]
    concurrency?: boolean | number
    coverage?: boolean
  }
}
