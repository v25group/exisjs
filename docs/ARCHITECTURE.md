# ExisJS Architecture Reference

This document serves as the architecture specification and technical reference for the internal subsystems, lifecycle execution pipeline, and design constraints of the ExisJS framework monorepo.

---

## 1. Monorepo Organization & Subsystems

ExisJS is architected as a modular TypeScript monorepo with no native add-ons. Per-request work (path matching, body parsing, validation, rate limit buckets) stays in JavaScript: crossing into a native binding costs more per call than these operations take in V8, and heavy work such as compression already runs in Node's built-in C libraries off the main thread.

```text
packages/
├── exisjs/        # Core TypeScript framework, HTTP pipeline, router, DI, Swagger, Telemetry
├── fetch/         # Lightweight, zero-dependency typed HTTP/RPC client
└── create/        # Scaffolding CLI tool (create-exisjs)
```

### Framework Module Mapping

| Subsystem | Source Path | Key Responsibilities |
| :--- | :--- | :--- |
| **Router Engine** | `packages/exisjs/src/router/` | File-system directory scanning, radix-tree route compilation, route grouping `(group)`, wildcard/param segments. |
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
3. Radix Tree Route Matching (static exact-match table, then tree walk)
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

## 4. Why There Is No Native Engine

Earlier versions shipped a Rust N-API package (`@exisjs/rs`). Measured per call, it was slower than plain JavaScript for every hot-path job it handled: route lookup (~7x), JSON parsing (~7x), validation, and cookie parsing, because converting values across the N-API boundary costs more than the work itself. It also meant prebuilt binaries for eight platforms and install failures elsewhere. It was removed; the TypeScript implementations are the only implementations.

Guidelines for keeping the core fast:

- Precompute at startup (route tables, compiled validators, static headers); do as little as possible per request.
- Avoid per-request closures, listeners, and object pools; short-lived objects are cheap for V8.
- Run CPU-heavy work (compression, hashing) through Node's async built-ins so it leaves the event loop.

---

## 5. Dependency Injection Architecture

The IoC container (`packages/exisjs/src/di/`) supports multiple provider token strategies:

1. **Class Providers**: `@Injectable()` decorated classes; constructor parameters are injected by `@Inject(Token)` (no reliance on emitted type metadata).
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
