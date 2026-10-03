# ExisJS Architecture Reference

This document serves as the architecture specification and technical reference for the internal subsystems, lifecycle execution pipeline, and design constraints of the ExisJS framework monorepo.

---

## 1. Monorepo Organization & Subsystems

ExisJS is architected as a modular TypeScript monorepo backed by a native Rust engine. Heavy compute tasks (path matching, memory LRU caching, rate limit buckets, and body sanitization) are handled by Rust native bindings via N-API (`@exisjs/rs`), with pure TypeScript fallbacks ensuring cross-platform stability.

```text
packages/
├── exisjs/        # Core TypeScript framework, HTTP pipeline, router, DI, Swagger, Telemetry
├── rs/            # Native Rust engine (radix routing, token bucket rate limiter, fast LRU cache)
├── fetch/         # Lightweight, zero-dependency typed HTTP/RPC client
└── create/        # Scaffolding CLI tool (create-exisjs)
```

### Framework Module Mapping

| Subsystem | Source Path | Key Responsibilities |
| :--- | :--- | :--- |
| **Router Engine** | `packages/exisjs/src/router/` | File-system directory scanning, `NativeRadixTree` route compilation, route grouping `(group)`, wildcard/param segments. |
| **Dependency Injection** | `packages/exisjs/src/di/` | Hierarchical IoC container, constructor injection reflection, custom providers (`useValue`, `useFactory`, `useExisting`, `useClass`), contextual `inject()`. |
| **Validation (`tex`)** | `packages/exisjs/src/validator/` | Schema definition AST (`tex.*`), discriminated unions, coercion primitives (`tex.coerce.*`), transforms, OpenAPI 3.1 duck-typing. |
| **HTTP Pipeline** | `packages/exisjs/src/server/` | `ExisRequest`, `ExisResponse`, lifecycle hooks (`onStart`, `onClose`), cookie parsing, proxy IP resolution. |
| **Folder Boundaries** | `packages/exisjs/src/router/boundary.ts` | Cascading directory configuration, CORS headers, security middleware, and directory-scoped DI providers. |
| **Decorators & OOP** | `packages/exisjs/src/decorators/` | `@Controller`, HTTP method decorators (`@Get`, `@Post`, `@RawBody`), `@Injectable`, `@Server`, `@Boundary`. |
| **Security & Middleware** | `packages/exisjs/src/middleware/` | `helmet()`, signed CSRF cookies, `hpp()`, CIDR `ipFilter()`, native `rateLimit()`, LRU `idempotency()`, streaming `upload()`. |
| **OpenAPI / Swagger** | `packages/exisjs/src/swagger/` | Interactive Swagger UI (`/docs`), OpenAPI 3.1 spec compiler from `tex` and Zod schemas. |
| **Telemetry & Observability** | `packages/exisjs/src/telemetry/` | Built-in OpenTelemetry tracing, span processors, and Prometheus metrics. |
| **Task Scheduling** | `packages/exisjs/src/cron/` | Drift-corrected background task scheduler (`cron()`, `@Cron()`). |
| **Testing Harness** | `packages/exisjs/src/testing/` | In-memory and HTTP integration test runner (`createTestApp`, `createTestContext`). |

---

## 2. Request Lifecycle & Execution Pipeline

Every HTTP request flows through a deterministic execution pipeline:

```text
Incoming HTTP Request (Node HTTP / uWS)
  │
  ▼
1. Core Server Hook & Request Context Initialization (AsyncLocalStorage)
  │
  ▼
2. Global Boundary & Middleware Pipeline (CORS, Helmet, Rate Limiter, IP Filter)
  │
  ▼
3. Radix Tree Route Matching (NativeRadixTree with Rust fallback)
  │
  ▼
4. Scoped Folder Boundaries (Cascading boundary.ts configurations)
  │
  ▼
5. Parameter Extraction & Schema Validation / Coercion (tex.* on Body, Query, Params)
  │
  ▼
6. Controller Handler Execution (Functional handler or OOP controller method)
  │
  ▼
7. Response Interceptors & Formatting (Fast serialization, ETag, Status Codes)
  │
  ▼
8. Post-Response Tasks (after() deferred execution callbacks)
```

### Context & AsyncLocalStorage

The execution pipeline utilizes `AsyncLocalStorage` via `executionContext` (`packages/exisjs/src/di/inject.ts`). This provides request isolation across concurrent async operations, powering:
- Contextual `inject(Token)` without parameter passing.
- `req.buffer()` lazy memoization for streaming webhooks.
- Deferred post-response cleanup tasks.

---

## 3. Dual-Paradigm Architecture

ExisJS maintains 100% feature parity between **Functional** and **Class-Based (OOP)** paradigms. An application chooses one paradigm consistently.

```text
┌─────────────────────────────────────────────────────────────┐
│                      Unified Pipeline                       │
│    (Validation Engine, Radix Dispatcher, OpenAPI Generator) │
└──────────────┬───────────────────────────────┬──────────────┘
               ▲                               ▲
               │                               │
    ┌──────────┴──────────┐         ┌──────────┴──────────┐
    │     Functional      │         │     Class-Based     │
    │  controller()       │         │  @Controller()      │
    │  route.get()        │         │  @Get(), @Post()    │
    │  defineBoundary()   │         │  @Boundary()        │
    │  exis({ onStart })  │         │  @Server()          │
    │  inject(Token)      │         │  @Inject(Token)     │
    └─────────────────────┘         └─────────────────────┘
```

Both paradigms compile down to identical internal `RouteDescriptor` structures registered in the route table.

---

## 4. The Graceful Fallback Pattern

Subsystems interfacing with `@exisjs/rs` (Radix router, LRU cache, rate limiting, and parameter validation) implement a strict fallback pattern. If N-API native binaries fail to load on non-standard architectures, the engine seamlessly activates pure TypeScript implementations:

```typescript
export class NativeSubsystemService {
  private nativeEngine: any
  private fallbackStore = new Map()
  private isFallback = false

  constructor() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { NativeSubsystem } = require('@exisjs/rs')
      this.nativeEngine = new NativeSubsystem()
    } catch {
      this.isFallback = true
    }
  }
}
```

---

## 5. Dependency Injection Architecture

The IoC container (`packages/exisjs/src/di/`) supports multiple provider token strategies:

1. **Class Providers**: `@Injectable()` decorated classes resolved via constructor metadata (`design:paramtypes`).
2. **Value Providers (`useValue`)**: Static configuration, database instances, or constants.
3. **Factory Providers (`useFactory`)**: Dynamic factory functions with dependency injection (`inject: [TokenA, TokenB]`).
4. **Alias Providers (`useExisting`)**: Token aliases mapping to an existing provider instance.

```typescript
// Custom Provider Registration
app.provide('DATABASE_CLIENT', {
  useFactory: (url: string) => createClient(url),
  inject: ['DATABASE_URL'],
})
```

---

## 6. Validation & Schema Engine (`tex`)

The validation subsystem provides a zero-dependency schema builder and parser:

- **Type AST**: `TexType` instances represent individual property constraints (`string`, `number`, `boolean`, `date`, `object`, `array`, `enum`, `discriminatedUnion`).
- **Coercion**: String parameter conversion via `tex.coerce.*` for query and path parameters.
- **Transformations**: Output reshaping using `.transform((val) => ...)` at the field and object level.
- **OpenAPI 3.1 Extraction**: Recursive duck typing translates `tex` schemas and external validator schemas (e.g. Zod) directly into OpenAPI 3.1 JSON Schemas.

---

## 7. Build Pipeline & Manifest Generation

In production mode:
1. `exisjs build` compiles TypeScript files using `esbuild`, bundling path aliases (`@/*`).
2. `RouteScanner` crawls `src/http/*` and writes a static route manifest to `.exis/routes-manifest.js`.
3. In production (`exisjs start`), the server loads the precompiled manifest for $O(1)$ startup without directory traversals.
