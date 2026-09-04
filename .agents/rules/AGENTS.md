# ExisJS Architectural Guidelines & Memory

**CRITICAL**: You are working in the ExisJS Monorepo. ExisJS is an ultra-high performance web framework that blends TypeScript Developer Experience with a raw Rust (C++) Engine under the hood.

Before modifying any code, you MUST understand this architecture.

## 1. The Monorepo Structure
- `packages/exisjs`: The core TypeScript framework and developer-facing APIs.
- `packages/rs`: The Rust native engine exposing bindings via N-API (`@exisjs/rs`).
- `packages/create`: The CLI scaffolding tool for generating new ExisJS projects (`create-exis`). Stays in TS as it only runs once during project setup.
- `packages/fetch`: A dedicated HTTP client. Stays in TS (wraps Undici/fetch).
- `packages/telemetry`: The OpenTelemetry and Prometheus adapters. Stays in TS to preserve compatibility with the Node.js observability ecosystem.
- **Rule**: Whenever you compile the Rust engine, ALWAYS run `cargo build` in `packages/rs` or `npm run build` from the workspace root.

## 2. The "Graceful Fallback" Pattern
Every efficient system in ExisJS uses a strict "Fallback Pattern" to ensure the framework still works on obscure OS architectures where N-API binaries might fail to load.
When writing TS classes, you MUST follow this structure:
```typescript
export class ExampleService {
  private nativeEngine: any
  private fallbackData = new Map()
  private isFallback = false

  constructor() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { NativeExample } = require('@exisjs/rs')
      this.nativeEngine = new NativeExample()
    } catch {
      this.isFallback = true
    }
  }
}
```

## 3. Directory & Subsystem Breakdown

### `src/router` (Routing & Validation)
- **Architecture**: Powered by `NativeRadixTree` in Rust (`packages/rs/src/core/radix.rs`).
- **Validation**: Compatible with both Zod and the custom native `TexValidator` via "Duck Typing" (checking `if (typeof validator.parse === 'function')`). 
- **Status**: 100% complete. Do not attempt to optimize this further.

### `src/auth` (Authentication)
- **`session.ts`**: Uses `NativeSessionStore` (HashMap + Mutex in C++). Thousands of sessions can be stored off-heap without triggering the V8 Garbage Collector.
- **`jwt.ts`**: Handles JSON Web Tokens.
- **`password.ts`**: Handles secure password hashing/verification.
- **`oauth/`**: Native OAuth Provider System (Google, GitHub, Microsoft, Discord, Facebook, Custom) with PKCE and state validation built-in.

### `src/middleware` (Traffic & Memory)
- **`cache.ts`**: Uses `NativeMemoryCache`. An off-heap LRU cache dodging V8 memory limits.
- **`idempotency.ts`**: Wraps the `NativeMemoryCache`. Intercepts massive JSON API responses and pushes them into C++ to prevent duplicate-request GC exhaustion.
- **`rate-limit.ts`**: Uses `NativeRateLimiter`. Fixed window algorithm running natively.
- **`ip-filter.ts`**: Uses `NativeIpFilter`. Compiles thousands of CIDR rules into 32-bit integers during startup for ~78x faster bitwise DDOS protection.

### `src/queue` (Background Jobs)
- **`MemoryDriver.ts`**: Uses `NativeMemoryQueue`.
- **`RedisDriver.ts`**: **STRICT RULE**: Do NOT port this to Rust. Redis polling remains strictly in pure TypeScript per the creator's explicit architectural decision.

### `src/threads` (Worker Threads)
- **Architecture**: Uses Node.js `worker_threads` to spawn background tasks (`pool.ts`, `worker-runner.ts`).
- **STRICT RULE**: Do NOT port this to Rust. User-defined background jobs are written in TS and must be executed by the V8 engine natively inside Node's worker threads.

### `src/server` (Core HTTP)
- **`request.ts`**: The core HTTP request wrapper. Heavy string parsing (JSON body parsing, Cookie parsing) is already delegated to `@exisjs/rs`.
- **`ws-orchestrator.ts`**: Handles WebSocket upgrades and routes them through the NativeRadixTree.
- **Status**: Stays in TS as structural boilerplate.

### `src/observability` (Telemetry)
- **`prometheus.ts`, `otel.ts`, `health.ts`**: Plug-and-play interfaces for external Node.js telemetry libraries (like `prom-client`). 
- **Status**: Stays in TS. No memory state is held, so Rust offers no benefit.

### 4. Comprehensive Framework Map (`packages/exisjs/src/*`)
To ensure complete context of the framework, here is the full directory map and feature breakdown:
- **`adapters/`**: Integrations with specific JS runtimes (Node, Bun, Cloudflare).
- **`app/`**: Core application bootstrap, context lifecycle, and global state.
- **`auth/`**: Authentication (Session via Rust, JWT, Password Hashing).
- **`cache/`**: Caching Engine (LRU Cache via Rust, Redis, FileSystem).
- **`cli/`**: The command-line interface logic for developers.
- **`config/` & `env.ts`**: Parsing and validating environment variables and `exis.config.ts`.
- **`cron/`**: Background task scheduler (Pure TS).
- **`database/`**: Core Database Layer. Supports PostgreSQL, MySQL, SQLite, MongoDB natively with built-in Migrator and QueryBuilder.
- **`dataloader/`**: GraphQL-style batching and caching to solve N+1 query problems.
- **`decorators/` & `di/` & `module/`**: The Dependency Injection engine. Wires up `@Controller`, `@Injectable`, and Module resolution at startup.
- **`error/`**: Global error handling and HTTP exceptions.
- **`integrations/`**: Third-party framework bridges.
- **`lib/`**: Bootstrap scripts like `start-server.ts` and `start-repl.ts`.
- **`middleware/`**: Traffic control (IP Filter, Rate Limit, Idempotency) powered by Rust.
- **`observability/`**: Telemetry adapters for OpenTelemetry and Prometheus.
- **`plugin/`**: The plugin lifecycle manager for extending ExisJS.
- **`queue/`**: Background jobs. `MemoryDriver` (Rust) and `RedisDriver` (TS).
- **`response/` & `server/` & `router/`**: The core HTTP Web Server. Handles req/res mapping and Radix routing (Rust).
- **`sanitize/` & `validator/`**: Data parsing and schema validation (Powered by TexValidator in Rust).
- **`storage/`**: File uploads and disk/S3 storage interfaces.
- **`swagger/`**: Auto-generation of OpenAPI specifications.
- **`testing/`**: Utilities for unit testing ExisJS apps.
- **`threads/`**: Node.js `worker_threads` for executing user-defined TS background jobs.
- **`utils/`**: Shared utilities like `logger.ts` and `circuit-breaker.ts`.
- **`websocket/`**: WebSockets implementation and connection pooling.

## 5. Overall Philosophy
- If an operation involves massive string manipulation, huge JSON objects, or caching thousands of items -> **Move to Rust off-heap**.
- If an operation involves networking, structural HTTP boilerplate, developer tooling, or executing user-defined logic -> **Keep in TypeScript**.
