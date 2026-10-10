# ExisJS Architectural Guidelines & Memory

**CRITICAL**: You are working in the ExisJS Monorepo. ExisJS is an opinionated, high-performance web framework for TypeScript backends built as a lightweight, pure TypeScript core with no native add-ons.

Before modifying any code, you MUST understand this architecture.

## 1. The Monorepo Structure

- `packages/exisjs`: The core TypeScript framework, HTTP pipeline, file-system router, developer-facing APIs, and built-in OpenTelemetry integration (`exisjs/telemetry`).
- `packages/create`: The CLI scaffolding tool for generating new ExisJS projects (`create-exis`).
- `packages/fetch`: A dedicated lightweight HTTP client (wraps Undici/fetch).

## 2. No Native Add-ons

The `@exisjs/rs` Rust/N-API package was removed: converting values across the N-API boundary cost more per call than the work it replaced (route lookup and JSON parsing were ~7x slower than plain JS). Do not reintroduce native bindings for per-request work. Performance rules:

- Precompute at startup (route tables, compiled validators, static headers); keep per-request work minimal.
- Avoid per-request closures, event listeners, and object pooling.
- Use Node's async built-ins (`zlib`, `crypto`) for CPU-heavy work so it leaves the event loop.
- Benchmark against the compiled `dist`, comparing CPU time per request, not raw req/s on a laptop.

## 3. Core Framework Architecture (`packages/exisjs/src/*`)

ExisJS maintains a clean, modular, and opinionated core:

- **`router/`**: Routing engine: radix tree (`router/radix.ts`) with an exact-match table for static paths. Handles file-system scanning, route compilation, and method dispatching.
- **`decorators/` & `di/` & `module/`**: The Inversion of Control (IoC) Dependency Injection container. Supports constructor injection via TypeScript `design:paramtypes` reflection, field injection (`@Inject()`, `@Optional()`), circular dependency resolution (`forwardRef()`), and `@Global()` / `@Module()` scopes.
- **`validator/` & `sanitize/`**: Integrated validation engine: the `tex.*` builder emits rule strings; `validator/compile.ts` generates one JS function per schema (like Ajv), calling the check closures in `validator/rules.ts` for rules it does not inline. `rules.ts` alone is the fallback where `new Function` is blocked, and `tests/validator-codegen.test.ts` keeps the two in agreement. Handles parameter coercion, type assertions, and zero-crash sanitization (`safeSanitize` for BSON/Dates/ORM models).
- **`middleware/`**: Built-in traffic control and security layers:
  - `security.ts`: `helmet()` headers, `csrf()` (signed double-submit cookie), `hpp()`, `mongoSanitize()`, `blockSuspiciousProbes()`, `timingSafeEqual()`, and `timeout()`.
  - `rate-limit.ts`: In-memory fixed-window rate limiter.
  - `ip-filter.ts`: Fast bitwise CIDR IP blocking.
  - `idempotency.ts`: Duplicate-request response caching via a bounded in-memory cache.
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
   - Keep developer-facing orchestration, route execution, and HTTP interfaces in clean TypeScript.
