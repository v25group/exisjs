import './config/env'

// ─── Core ─────────────────────────────────────────────────────────────────────
export { defineApp as exis } from './server/define'
export { type App, getActiveApp } from './server/app'
export { defineConfig } from './config/config'
export { parseEnv, loadEnv } from './config/env'

// ─── Response Utilities ───────────────────────────────────────────────────────
export {
  success,
  created,
  accepted,
  noContent,
  error,
  problem,
  paginate,
  getPaginationSkip,
  json,
  redirect,
  HttpStatus,
  getStatusText,
  isSuccessStatus,
  isRedirectStatus,
  isClientError,
  isServerError,
  ExisResponse,
  SSEStream,
  formatSSEEvent,
  type SuccessResponse,
  type ErrorResponse,
  type ApiResponse,
  type PaginationMeta,
  type PaginatedResponse,
  type ProblemDetails,
  type ResponseHeaders,
  type HttpStatusCode,
  type SSEMessage,
  type SSEOptions,
  type CookieOptions,
} from './response'

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
