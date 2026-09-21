import type { LoggerConfig, Logger } from '../types'
import { createLogger } from '../utils/logger'

// ─── Default Redact Paths ─────────────────────────────────────────────────────

const DEFAULT_REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.token',
  'req.body.secret',
  '*.password',
  '*.token',
  '*.secret',
  'password',
  'token',
  'secret',
]

// ─── Singleton State ──────────────────────────────────────────────────────────

let _instance: Logger = createLogger({
  level: 'info',
  pretty: process.env.NODE_ENV !== 'production',
  redact: DEFAULT_REDACT,
})

let _configured = false

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * The global application logger.
 *
 * Mirrors `console.log/warn/error` method names, making it a near drop-in
 * replacement. A developer migrating from `console.log('Server started')`
 * just swaps the import and gets structured output, redaction, and level
 * control for free.
 *
 * @example
 * ```ts
 * import { logger } from 'exisjs/logger'
 *
 * logger.info('Server started')
 * logger.warn('Deprecated config option used')
 * logger.error({ err }, 'Failed to connect')
 * logger.debug({ userId: id }, 'Fetching user')
 * ```
 */
export const logger: Logger = new Proxy({} as Logger, {
  get(_target, prop, receiver) {
    return Reflect.get(_instance, prop, receiver)
  },
})

/**
 * Configure the global logger. Call once, usually in `exis.config.ts` or
 * `server.ts`. Every `logger.info()` anywhere in the app — plus the
 * internal `ctx.log` / `inject(Logger)` calls — picks up the new settings
 * because they all point at the same underlying proxy.
 *
 * Redact paths are **merged** with the built-in defaults unless you pass
 * `replaceRedact: true`.
 *
 * @example
 * ```ts
 * import { configureLogger } from 'exisjs/logger'
 *
 * configureLogger({
 *   level: 'debug',
 *   pretty: true,
 *   redact: ['*.password', '*.apiKey', 'customSecretField'],
 * })
 * ```
 */
export function configureLogger(
  config: LoggerConfig & { replaceRedact?: boolean }
): void {
  const redact = config.replaceRedact
    ? (config.redact ?? [])
    : [...DEFAULT_REDACT, ...(config.redact ?? [])]

  // De-duplicate
  const uniqueRedact = [...new Set(redact)]

  _instance = createLogger({
    level: config.level ?? 'info',
    pretty: config.pretty ?? process.env.NODE_ENV !== 'production',
    redact: uniqueRedact,
  })

  _configured = true
}

/**
 * Replace the global logger entirely with your own instance.
 * The provided object must satisfy the `Logger` interface (i.e. expose
 * `.info()`, `.warn()`, `.error()`, `.debug()`, `.child()`, etc.).
 *
 * @example
 * ```ts
 * import { setLogger } from 'exisjs/logger'
 * import pino from 'pino'
 *
 * setLogger(pino({ level: 'trace', transport: { target: 'pino-loki' } }))
 * ```
 */
export function setLogger(custom: Logger): void {
  _instance = custom
  _configured = true
}

/**
 * Returns the current underlying logger instance.
 * Used internally by the framework (e.g. `App`, middleware) to share the
 * same logger the developer configured.
 *
 * @internal
 */
export function getLoggerInstance(): Logger {
  return _instance
}

/**
 * Returns `true` if the developer has called `configureLogger()` or
 * `setLogger()`. Used by the framework to decide whether to apply its
 * own config-based logger settings.
 *
 * @internal
 */
export function isLoggerConfigured(): boolean {
  return _configured
}

/**
 * Reset the logger to defaults. Used in tests.
 * @internal
 */
export function resetLogger(): void {
  _instance = createLogger({
    level: 'info',
    pretty: process.env.NODE_ENV !== 'production',
    redact: DEFAULT_REDACT,
  })
  _configured = false
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export {
  createLogger,
  createSilentLogger,
  isLogger,
  formatBytes,
  formatLatency,
  formatMethod,
  formatStatus,
  formatUrl,
  formatIp,
  extractValidationSummary,
  extractErrorMessage,
} from '../utils/logger'
export type { Logger, LoggerConfig } from '../types'
