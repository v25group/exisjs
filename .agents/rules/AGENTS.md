# ExisJS Architectural Guidelines & Memory

**CRITICAL**: You are working in the ExisJS Monorepo. ExisJS is an opinionated, high-performance web framework for TypeScript backends powered by a native Rust engine (`@exisjs/rs`) under the hood for zero-allocation routing, memory caching, rate limiting, and input validation.

Before modifying any code, you MUST understand this architecture.

## 1. The Monorepo Structure

- `packages/exisjs`: The core TypeScript framework, HTTP pipeline, file-system router, developer-facing APIs, and built-in OpenTelemetry integration (`exisjs/telemetry`).
- `packages/rs`: The Rust native engine exposing high-performance bindings via N-API (`@exisjs/rs`).
- `packages/create`: The CLI scaffolding tool for generating new ExisJS projects (`create-exis`).
- `packages/fetch`: A dedicated lightweight HTTP client (wraps Undici/fetch).
- **Rule**: Whenever you compile the Rust engine, ALWAYS run `cargo build` in `packages/rs` or `npm run build` from the workspace root.

## 2. The "Graceful Fallback" Pattern

High-performance native subsystems in ExisJS use a strict "Fallback Pattern" to ensure the framework still operates seamlessly on obscure OS architectures where N-API binaries might fail to load.
When writing TS classes that interface with `@exisjs/rs`, follow this structure:

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

## 3. Core Framework Architecture (`packages/exisjs/src/*`)

ExisJS maintains a clean, modular, and opinionated core:

- **`router/`**: High-performance routing engine powered by `NativeRadixTree` in Rust (`packages/rs/src/core/radix.rs`). Handles file-system scanning, route compilation, and method dispatching with zero runtime allocations.
- **`decorators/` & `di/` & `module/`**: The Inversion of Control (IoC) Dependency Injection container. Supports constructor injection via TypeScript `design:paramtypes` reflection, field injection (`@Inject()`, `@Optional()`), circular dependency resolution (`forwardRef()`), and `@Global()` / `@Module()` scopes.
- **`validator/` & `sanitize/`**: Integrated validation engine powered by `TexValidator` in Rust and TypeScript schema builder (`tex.*`). Handles parameter coercion, type assertions, and zero-crash sanitization (`safeSanitize` for BSON/Dates/ORM models).
- **`middleware/`**: Built-in traffic control and security layers:
  - `security.ts`: `helmet()` headers, `csrf()` (signed double-submit cookie), `hpp()`, `mongoSanitize()`, `blockSuspiciousProbes()`, `timingSafeEqual()`, and `timeout()`.
  - `rate-limit.ts`: Native rate limiter backed by `@exisjs/rs`.
  - `ip-filter.ts`: Fast bitwise CIDR IP blocking.
  - `idempotency.ts`: Duplicate-request response caching via native LRU memory cache.
  - `upload.ts`: File upload and streaming multipart form-data parser.
- **`server/` & `response/`**: The core HTTP server abstraction (`ExisRequest`, `ExisResponse`), request context, and lifecycle hooks (`onStart`, `onStop`).
- **`cron/`**: Built-in background task scheduler and cron engine (`cron()` helper & `@Cron()` decorator) with automatic drift correction and overlap prevention.
- **`database/`**: Database lifecycle manager (`registerDatabase`), health check coordinator (`DatabaseManager`), Mongoose 8/9 interop, and universal transaction runner (`withTransaction`).
- **`error/`**: Standardized HTTP exception hierarchy (`HttpError`, `BadRequestException`, `UnauthorizedException`, etc.) and JSON error envelopes.
- **`logger/` & `utils/`**: Structured Pino-based logger with automatic credential redaction, time formatting, and `CircuitBreaker`.
- **`swagger/`**: Automatic OpenAPI 3.1 schema and interactive documentation generator (`/docs`).
- **`testing/`**: Integrated E2E testing context (`createTestApp`, `createTestContext`).
- **`config/`**: Configuration parser (`defineConfig`) and type-safe environment validator (`tex.env`).
- **`cli/`**: Developer CLI tool (`dev`, `build`, `start`, `routes`, `manifest`).

## 4. Architectural Conventions & Rules

1. **Paradigms**: ExisJS supports two paradigms with 100% feature parity:
   - **Functional**: `controller()`, `route.get()`, `cron()`, `defineBoundary()`, `inject()`.
   - **Class-Based (OOP)**: `@Controller()`, `@Get()`, `@Cron()`, `@Boundary()`, `@Injectable()`.
   - A single application must strictly choose one paradigm.
2. **Auto-Discovery Folders**:
   - `src/http/*`: Routes (`route.ts`), boundaries (`boundary.ts`), validation schemas (`schema.ts`), services (`service.ts`), and error handler (`error.ts`).
   - `src/cron/*`: Dedicated scheduled cron tasks (e.g. `src/cron/cleanup.ts`).
3. **Dedicated Convention Folders**:
   - `src/database/`: Database client & lifecycle (`db.ts`), models (`models/`), repositories, and migrations.
   - `src/common/`: Shared guards (`guards/`), interceptors, and filters.
   - `src/config/`: Environment configuration (`env.ts`).
4. **Clean Core Philosophy**:
   - Keep the core framework lean, typed, and structured.
   - External data stores, heavy queue drivers (like Redis), and specialized tools should remain pluggable and modular.
   - Offload heavy operations (path matching, off-heap caching, CIDR IP filtering, body sanitization) to Rust via `@exisjs/rs`.
   - Keep developer-facing orchestration, route execution, and HTTP interfaces in clean TypeScript.
