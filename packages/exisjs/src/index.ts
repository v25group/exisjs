import './config/env'

// ─── Core ─────────────────────────────────────────────────────────────────────
export { defineApp as exis } from './server/define'
export { type App, getActiveApp } from './server/app'
export { defineConfig } from './config/config'

// ─── Logger ───────────────────────────────────────────────────────────────────
export { createLogger } from './utils/logger'

export { parseEnv, loadEnv } from './config/env'

// ─── Circuit Breaker ───────────────────────────────────────────────────────

export {
  CircuitBreaker,
  CircuitBreakerError,
  CircuitState,
} from './utils/circuit-breaker'

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  ExisConfig,
  ExisPlugin,
  ExisPluginInstance,
  Logger,
  CorsConfig,
  LoggerConfig,
  HookRequest,
} from './types'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ExisUser {}
