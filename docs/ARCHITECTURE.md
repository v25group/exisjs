# ExisJS Architecture Reference

This document is the single source of truth for how the ExisJS core engine is built internally.

ExisJS core is a minimal, ultra-high-performance web framework runtime: file-system routing, dependency injection, validation (`tex`), sanitization, and an HTTP request pipeline. Everything else — databases, external auth providers, cache stores, queues, websockets — is extracted into official `@exisjs/*` packages.

---

## 1. File-System Routing 🟢

**What it is:** Folder-based routing mapping HTTP routes to the file system (`route.ts`, `boundary.ts`, `server.ts`, `schema.ts`, `service.ts`).

**How it's implemented:** At boot, `RouteScanner` walks the configured `src/http` directory (or a custom `apiDir`) and registers discovered routes into the `Router`'s matching engine powered by the Rust `NativeRadixTree`. Folder-naming conventions are translated during the scan:

- `[param]` → `:param` dynamic segment
- `[...param]` → `*param` catch-all
- `(group)` → ignored entirely in the resulting URL, but still traversed for nested routes

In development, routes are mounted dynamically and watched by `HotReloader`. In production, `exis build` pre-generates a route manifest (`.exis/routes-manifest.js`) for instant O(1) boot.

---

## 2. Dual Paradigm: Functional & Class-Based (OOP) 🟢

**What it is:** Two ways to define routing and handlers — `controller()`/`route.*()` factory functions, or `@Controller()`/`@Get()` class decorators — that compile down to the same internal `Route` representation.

**How it's implemented:** Class decorators attach metadata to the class prototype via symbols (`Symbol.for('exisjs:...')`) without any `reflect-metadata` dependency. The router processes both paradigms through the exact same internal pipeline. Choose one paradigm per project.

---

## 3. The Context API & `AsyncLocalStorage` 🟢

**What it is:** Access to the current request's `req`/`res`/app-scoped state from anywhere in the call graph without prop-drilling, plus `after()` for deferred post-response work.

**How it's implemented:** `AsyncLocalStorage` maintains an active store per request containing `{ state, afterCallbacks, req, res, app, diCache }`. `inject()`, `getContext()`, and `after()` read from this store, guaranteeing request isolation across concurrent requests.

---

## 4. Dependency Injection (`Container`) 🟢

**What it is:** An IoC container supporting value, factory, and class providers, with singleton and request scoping.

**How it's implemented:** `Container` holds provider definitions and a singleton cache. Inside request handlers, `inject(token)` resolves dependencies dynamically using the request's context store.

---

## 5. Folder-Scoped Boundaries (`boundary.ts`) 🟢

**What it is:** Folder-level configuration and auto-detected request pipelines that apply to a directory and all its subdirectories recursively.

**How it's implemented:**
1. **Config:** Export `config = defineBoundary(...)` (functional) or `@Boundary(...)` (OOP) to define CORS, headers, exclusions, and DI providers for that directory tree.
2. **Auto-Detected Pipeline:**
   - Functions matching `(req, res, next)` are auto-detected as sequential chain steps.
   - The default export `(ctx, next)` (functional) or class method `handle(ctx, next)` (OOP) is auto-detected as an onion wrapper around all inner steps and child routes.

---

## 6. Native Validation Engine (`tex`) 🟢

**What it is:** A dependency-free, high-performance schema validator powered by Rust (`@exisjs/rs`) with strict typing, auto-coercion, and structured error responses.

**How it's implemented:** `tex` provides primitives (`string`, `number`, `boolean`, `email`, `object`, `array`, `enum`) and integrates directly with `route.*()` configs and `@Body()`. Input sanitization via `exisjs/sanitize` can be chained synchronously via `.sanitize(...)` before validation occurs.

---

## 7. Production Build & Manifest Pipeline 🟢

- **esbuild Compilation:** `exis build` bundles and transpiles TypeScript rapidly using esbuild, resolving path aliases (`@/*`).
- **Route Manifest Generation:** Scans routes and writes `.exis/routes-manifest.js` to enable O(1) boot in production without recursive filesystem scanning.
- **Fast Serialization:** Validated route responses integrate with JIT fast serializers.

---

## 8. Request & Response Engine 🟢

- **Request:** Native JSON body parsing and cookie parsing delegated to Rust off-heap bindings in `@exisjs/rs`, busboy for multipart form data, and robust proxy trust resolution.
- **Response:** Chainable status, header, and cookie APIs, automatic ETag generation (weak ETags), and JSON auto-serialization.

---

## 9. Global Error Handling 🟢

Structured `HttpError` hierarchy (`badRequest`, `unauthorized`, `forbidden`, `notFound`, etc.) with consistent JSON error envelopes and dev-mode formatting.

---

## 10. Core Middleware Suite 🟢

- **Security:** `helmet()`, `csrf()`, `hpp()`, `dbSanitize()`, `timeout()`.
- **Traffic & Performance:** In-memory off-heap `rateLimit()`, `idempotent()` (keyed response caching in off-heap memory), `dedupe()`, and `backpressure()`.
- **Utilities:** `cors()`, `requestId()`, `requestLogger()`, `serveStatic()`.

---

## 11. Core Boundary Contract

| Subsystem | Location | Scope |
|---|---|---|
| Routing & Boundaries | `exisjs/router` | Core runtime |
| Schema & Validation | `exisjs/validator` (`tex`) | Core runtime |
| Data Sanitization | `exisjs/sanitize` | Core runtime |
| Dependency Injection | `exisjs/di` | Core runtime |
| Core Middleware | `exisjs/middleware` | Core runtime |
| CLI & Scaffolding | `exisjs/cli` | Core tooling |
| Database & ORM | `@exisjs/database` | Extracted package |
| Cache & Redis | `@exisjs/cache` | Extracted package |
| Background Queues | `@exisjs/queue` | Extracted package |
| WebSockets | `@exisjs/websocket` | Extracted package |
| Auth & OAuth | `@exisjs/auth` | Extracted package |
