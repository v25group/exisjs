import './utils/env'

// ─── Core ─────────────────────────────────────────────────────────────────────
export { defineApp as exis } from './server/define'
export { type App, getActiveApp } from './server/app'
export { defineConfig } from './utils/config'

// ─── Logger ───────────────────────────────────────────────────────────────────
export { createLogger } from './utils/logger'

export { parseEnv, loadEnv } from './utils/env'

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
