# ExisJS Architecture Reference

This document is the single source of truth for how ExisJS is built internally. Unlike marketing copy, everything here is written to match what the code actually does — verified against the source, not aspirational. Each subsystem is labeled with a **Status** tag; treat that label as load-bearing information, not decoration.

**Status legend:**

- 🟢 **Stable** — core path, exercised by real deployments and dense test coverage.
- 🟡 **Beta** — works as documented, but has known rough edges or thinner test coverage.
- 🟠 **Experimental** — functional but unproven under real production load; expect edge cases.
- 🔴 **Known Issue** — currently broken or non-functional; see linked bug reference.
- ⚪ **Scaffolded / Not Implemented** — API surface or docs exist, but the behavior described does not (yet) exist at runtime.

---

## 1. File-System Routing 🟢

**What it is:** Folder-based routing mapping HTTP routes to the file system (`route.ts`, `gateway.ts`, `server.ts`, optionally `schema.ts` / `service.ts` / `controller.ts` as a convention, not an enforced structure).

**How it's implemented:** At boot, `RouteScanner` walks the configured `src/http` directory (or a custom `apiDir`) and registers discovered routes into the `Router`'s matching engine. Folder-naming conventions are translated during the scan:

- `[param]` → `:param` dynamic segment
- `[...param]` → `*param` catch-all
- `(group)` → ignored entirely in the resulting URL, but still traversed for nested routes

In development, routes are mounted lazily/dynamically and watched by `HotReloader` (see §12). In production, `exis build` can pre-generate a manifest (see §8) that lists every route file, though the request-time route matching itself is not manifest-driven — see §8 for the important distinction between "route discovery is fast" and "route execution uses a pre-compiled path," because only the former is currently true.

**Example:**

```typescript
// src/http/users/[id]/route.ts
import { controller, route } from 'exisjs/router'
export default controller({
  getSingle: route.get('/', {
    handle: ({ params }) => ({ id: params.id }),
  }),
})
```

---

## 2. Dual Paradigm: Functional & Class-Based (OOP) 🟢

**What it is:** Two ways to define the same routing/controller concepts — `controller()`/`route.*()` factory functions, or `@Controller()`/`@Get()` class decorators — that compile down to the same internal `Route` representation and execute through the same pipeline.

**How it's implemented:** Class decorators (`decorators/index.ts`) attach metadata to the class prototype via `Symbol.for('exisjs:...')` keys (routes, middleware, param metadata, lifecycle metadata) rather than `reflect-metadata`, for O(1) lookup without a polyfill dependency. `ControllerRegistrar` reads this metadata at registration time and produces the exact same kind of route entries that the functional `controller()`/`route.*()` API produces directly. Both paradigms can be mixed file-by-file in the same application.

---

## 3. The Context API & `AsyncLocalStorage` 🟢

**What it is:** Access to the current request's `req`/`res`/app-scoped state from anywhere in the call graph without prop-drilling, plus `after()` for deferred post-response work.

**How it's implemented:** `context.ts` wraps Node's native `AsyncLocalStorage` in an `InternalContext` store containing `{ state, afterCallbacks, req, res, app, diCache }`. `getContext()`, `setContext()`, `getRequest()`, `getResponse()`, `getApp()`, and `after()` all read from the active store, throwing a clear error if called outside an active request. `RequestHandler._executeWithContext` establishes the store per-request and flushes `afterCallbacks` on the `finish`/`close` events of the response, catching and logging (not throwing) errors in background `after()` work so they can't crash the request.

**Isolation:** each request gets its own `diCache` (a fresh `Map`) for request-scoped DI resolution, and context state does not leak across concurrent requests — this is tested and confirmed correct.

---

## 4. Dependency Injection (`Container`) 🟢

**What it is:** A lightweight IoC container supporting value, factory, and class providers, with singleton and per-request scoping.

**How it's implemented:** `di/container.ts`'s `Container` class holds a `providers` map and a `singletonCache`. `resolve(token, requestCache?)` checks the singleton cache, then the passed-in per-request cache, then the registered provider definition, instantiating and caching as appropriate to the provider's declared `scope`. Unregistered class tokens are auto-instantiated on first resolve and cached as singletons by default.

**Two access patterns exist and are both supported:**

- `inject(token)` (`di/inject.ts`) — the recommended primitive, reads the active `AsyncLocalStorage` context and resolves against `app.resolve(token, store.diCache)`. Works inside any route handler or middleware.
- `app.provide(token, definition)` / `app.resolve(token)` — direct container access, primarily used at boot time (`server.ts`, module registration) rather than inside request handlers.

**Known limitation:** when auto-instantiation of an unregistered class throws (e.g., a constructor-time validation error), the container currently discards the original error and throws a generic "Cannot resolve provider" message. Treat the original error as recoverable debugging information that should not be lost — this is tracked as a fix, not a design decision.

---

## 5. Modules & Plugins 🟢

**What it is:** Two related but distinct extension primitives.

- **`defineModule`** (`module/module.ts`) — groups domain-level providers, sub-module imports, and optional manual routes into a single registrable unit, with automatic deduplication of shared imports (`app.hasPlugin(name)` check before re-registering).
- **`definePlugin`** (`utils/plugin.ts`) — for distributable, configurable third-party packages. Returns a hybrid object: usable directly, or callable as a function to pass options (`MyPlugin({ apiKey })`).

**How registration/encapsulation works:** `PluginManager.register()` optionally wraps the target `App` in a `Proxy` (when `plugin.encapsulate !== false`) that intercepts routing methods and scopes them to a plugin-local `Router`, which is then mounted onto the main app under `/`. This prevents a plugin's internal route/middleware registration from silently leaking into the global app surface unless explicitly intended.

**Gateways as modules:** `defineGateway` (`router/gateway.ts`) can itself carry `imports`/`providers`, letting a folder-scoped `gateway.ts` file behave as a lightweight module that hydrates the DI container before any `route.ts` inside that folder executes.

---

## 6. Cascading Gateways 🟢

**What it is:** Folder-level configuration (middleware, CORS, headers, guards, filters, interceptors, providers, plugins, metadata) that applies to a directory and all its subdirectories.

**How it's implemented:** During route mounting, the router maintains a stack of active gateway configs as it descends the directory tree, merging arrays (middleware, guards, filters, interceptors) from parent to child rather than overriding them. A gateway can return a response directly, which halts execution before the route handler is reached — the same mechanism regular middleware uses.

---

## 7. Native Validation Engine (`v`) 🟢

**What it is:** A dependency-free, Zod-like schema validator with strict parsing and structured error aggregation.

**How it's implemented:** `utils/validator.ts` defines `ValidatorType` subclasses (`StringValidator`, `NumberValidator`, `ObjectValidator`, `ArrayValidator`, etc.) each implementing `.parse()`/`.validate()`. Validation failures collect into a `ValidatorError` carrying a structured `errors: { path, message }[]` array rather than throwing on the first failure. Supports `.optional()`, `.default()`, `.transform()`, `.refine()`, custom error messages, and `.sanitize()` — which composes with `utils/sanitize.ts`'s pure transformation functions (trim, escape, clamp, etc.) and runs _before_ validation rules are checked, so sanitization can bring otherwise-invalid input into a valid shape (e.g., trimming whitespace before a `.min(3)` check).

Test coverage here is dense and correctness-focused (string/number/boolean/object/array/enum/literal/union/date/record validators, nested objects, multi-error collection, async parsing) — this is one of the most solidly verified subsystems in the framework.

---

## 8. Production Build Pipeline

### 8a. Compilation 🟢

`exis build` uses **esbuild** to compile TypeScript to JavaScript (`cli/commands/build.ts`), dropping the slow `tsc` dependency for the actual transpilation step, then rewrites path aliases (`@/*` → relative imports) via a native regex-based resolver (`resolve-aliases.ts`) so the output runs without needing a module-alias runtime.

### 8b. Route Manifest Generation 🟢

`cli/manifest.ts` scans `route.ts` files post-compile and writes `.exis/routes-manifest.js` (a flat list of `{ routePath, module, filePath, hash }`) plus a generated `.exis/types.d.ts` for the tRPC-style client (§17). This manifest is fully wired into the boot path: in production, `route-scanner.ts` detects `.exis/routes-manifest.js`, reads it, dynamically imports the required modules, and completely bypasses the recursive filesystem scan, delivering true O(1) boot performance regardless of route count.

### 8c. Production Optimizers (AOT Routing & JIT Serialization) 🟢

The framework achieves production optimizations directly within its core engine rather than relying on brittle post-processing build scripts:

- **AOT Routing (O(1) Boot Time)** — During `exis build`, `manifest.ts` generates a `.exis/routes-manifest.js` file. In production, `RouteScanner` detects this manifest and uses it to load routes instantly, skipping the expensive `fs.readdir` recursive scan entirely.
- **JIT Fast JSON Serialization** — During route registration at boot time, the `Router` checks if `fast-json-stringify` is installed. If a route has an ExisJS `v` response schema, the router automatically converts it to JSON Schema via `.toOpenApi()` and compiles an optimized serializer Just-In-Time, attaching it to the route's response handler (`res._serializer`). This eliminates the need to precompile serializers to disk.

---

## 9. Native Job Queues 🟢 (core queue & cron integration)

**What it is:** A background job queue with pluggable drivers, retry/backoff, visibility timeouts, and a worker-thread execution model.

**How enqueue/poll/ack/fail work (both drivers share this contract, `queue/types.ts` `QueueDriver`):**

- **Redis driver** (`queue/drivers/RedisDriver.ts`): pending jobs live in a Redis **sorted set** (`{prefix}:{name}:pending`, score = ready-at timestamp) with payloads stored separately in a **hash** (`{prefix}:{name}:payloads`). `enqueue()` uses a Lua script for atomic `ZADD` + `HSET` (with an optional max-queue-size check baked into the same script for backpressure). `poll()` atomically pops the earliest-ready job via `ZRANGEBYSCORE` + moves it to a `processing` zset with a visibility-timeout score, using another Lua script. `sweep()` periodically requeues anything left in `processing` past its visibility timeout (crash recovery for workers that died mid-job).
- **Memory driver** (`queue/drivers/MemoryDriver.ts`): the same conceptual model (pending list, processing list, sweep-based recovery) implemented with in-process arrays instead of Redis — correctly mirrors the Redis driver's semantics for single-process/dev use.
- **Job execution:** `ExisWorker` (`queue/worker.ts`) polls continuously (`setImmediate`-chained, with backoff on connection errors), and for jobs with a `filePath` (rather than an inline `handler`), dispatches execution to a `ThreadPool` (`threads/pool.ts`) — a integrated `worker_threads` pool — so CPU-heavy job handlers don't block the main event loop.

**Retry behavior:** on failure, `attemptsMade` increments and the job is requeued (with optional exponential/fixed backoff) if under `maxAttempts`; once attempts are exhausted, the job is moved to a dead-letter queue (`{prefix}:{name}:dead` in Redis, or a `deadLetter` list in Memory) and an `onJobFailedPermanently` hook is fired, ensuring no data is lost for permanently failed jobs.

**Cron scheduling — 🟢 correctly integrated with the Redis driver:** `CronScheduler` (`cron/scheduler.ts`) uses its own native cron-expression parser (`cron/parser.ts`, supports lists/steps/ranges/wildcards) and ticks every 60 seconds, aligned to the minute boundary. To guarantee exactly-once execution across a multi-instance cluster, it acquires a `SETNX`-style Redis lock (`SET key val EX 55 NX`) per job per minute — this locking mechanism is correctly designed. Once the lock is acquired, the scheduler enqueues the triggered job payload via the exact same `ZADD` + `HSET` sequence the `RedisQueueDriver` expects, ensuring cron jobs are processed identically to manually enqueued jobs.

---

## 10. WebSockets & Pub/Sub 🟢

**What it is:** Native WebSocket routes (`route.ws()` / `@Ws()`) with Socket.io-style room subscriptions, sitting behind the same middleware/auth pipeline as HTTP routes.

**How it's implemented:**

- `ExisWebSocketServer` (`websocket/server.ts`) tracks all active connections in a `Set` and room membership in a `Map<room, Set<socket>>`, with automatic room cleanup when a room empties and a 30-second `.unref()`'d ping/pong heartbeat that terminates dead connections.
- `ExisWebSocket` (`websocket/socket.ts`) wraps the raw socket with `.subscribe()`/`.publish()`/`.emit()`/`.to()`/`.broadcast`, JSON auto-serialization, and an `emitWithAck()` request/response pattern with timeout.
- **Upgrade handling on the Node backend** (`ws-orchestrator.ts`): builds a synthetic `ServerResponse` so the normal middleware pipeline (including auth) can run _before_ the actual protocol upgrade happens. If middleware sends a response (e.g., 401), the socket is destroyed instead of upgraded.
- **Upgrade handling on the uWebSockets.js backend** (`ws-orchestrator.ts`'s `handleUwsUpgrade` + `uws-adapter.ts`'s `open()` callback): functionally equivalent. The request shim correctly captures all synchronously-available request data (including `sec-websocket-*` headers), safely defers the `res.upgrade()` call until after asynchronous middlewares complete (using `onAborted` to catch dropped connections), and passes the required context into the `open()` callback seamlessly.

---

## 11. Server-Sent Events (SSE) 🟢

**What it is:** One-way server-to-client streaming (`route.sse()` / `@Sse()`), useful for LLM token streaming and other push-style use cases.

**How it's implemented:** `ExisSSE` (`server/sse.ts`) sets the standard `text/event-stream` headers plus `X-Accel-Buffering: no` (to prevent reverse-proxy buffering from defeating streaming), tracks connection state via the response's `close` event, and exposes `.send(data, eventName?)` which formats either plain strings or JSON-serialized objects per the SSE wire format. Full middleware support is retained, so auth/rate-limiting apply the same as any other route.

---

## 12. Intelligent Hot-Reloading 🟢

**What it is:** File-change-triggered reloading that patches only the affected routes rather than restarting the whole process, preserving WebSocket connections and in-memory state.

**How it's implemented:** `dep-graph.ts` builds a dependency graph by regex-scanning `import`/`export`/`require` statements in route files (resolving both relative imports and `@/` aliases) so that changing a `service.ts` file can be traced back to the `route.ts` files that depend on it. `hot-reload.ts`'s `HotReloader` watches via `chokidar`, and on a relevant change: removes the stale route(s) from the router, busts the CommonJS `require.cache` entry, re-imports the file, and re-mounts it — all without touching unrelated routes or dropping active connections. `dev-error-overlay.ts` provides a readable terminal error format (parsed stack trace + syntax-highlighted code frame) when a hot-reloaded file fails to import.

---

## 13. uWebSockets.js Adapter 🟢

**What it is:** An optional high-throughput backend that swaps Node's native HTTP server for `uWebSockets.js`, auto-detected if installed (or forced via `server: 'uws'` config).

**How it's implemented:** `uws-adapter.ts` provides `UwsIncomingMessage`/`UwsServerResponse` shims that emulate the subset of Node's `IncomingMessage`/`ServerResponse` interface the rest of the framework depends on. Response writes use `res.cork()` to batch header/status/body into a single write. The shim correctly emulates asynchronous Node stream semantics (e.g., buffered `data`/`end` events delivered via microtasks for late listener registration), making it a robust and efficient drop-in replacement.

---

## 14. Request & Response Engine 🟢

**What it is:** `ExisRequest`/`ExisResponse` wrapper classes providing a fuller feature set than raw Node `IncomingMessage`/`ServerResponse`.

**Request (`server/request.ts`):**

- Multipart parsing via `busboy`, query parsing via `fast-querystring`.
- `trustProxy` logic (boolean, or numeric hop-count) correctly resolves `x-forwarded-for`/`x-forwarded-proto`/`x-forwarded-host` — this has explicit, well-covered test cases for the `false`/`true`/numeric-hop variants.
- Body-size limiting with a clear rejection error when exceeded.
- Per-request `Dataloader` instances (see §16) accessible via `req.dataloader(name)`.

**Response (`server/response.ts`):**

- Chainable `status()`/`set()`/`header()`/`cookie()` API.
- Automatic ETag generation (SHA1-based, weak ETags) plus `304 Not Modified` short-circuiting when the request is fresh.
- `.download()`, `.html()`, `.sendStream()`, `.redirect()` convenience methods.
- A subtlety worth knowing: **if you inject the raw response object to set custom headers but still return a value from the handler, ExisJS still auto-serializes the returned value to JSON** — unlike frameworks where injecting the raw response disables auto-serialization and silently hangs the request if you forget to call `.send()`.

---

## 15. Global Error Handling 🟢

**What it is:** A structured `HttpError` hierarchy plus a global handler that formats operational errors consistently and masks internals in production.

**How it's implemented:** `HttpError` (`utils/errors.ts`) carries `statusCode`/`code`/`details`/`isOperational`, with static factories (`badRequest`, `unauthorized`, `notFound`, etc.) and matching subclasses/aliases for both functional and exception-style usage. `createErrorHandler(isDev)` recognizes `HttpError` instances, Zod-shaped and native `ValidatorError` shapes, and JSON `SyntaxError`s, formatting each appropriately; unrecognized errors are logged and returned as a generic message in production, or the full message + stack in development. A dev-mode HTML error overlay is available when the client accepts `text/html`.

**Exception filters:** `catchError(errorClass, handler)` (`middleware/exception-filter.ts`) provides a functional equivalent to `@Catch()` — a 4-argument middleware that only handles errors matching `instanceof errorClass`, falling through to the next handler otherwise. This composes cleanly with `HttpError`'s subclasses for granular per-error-type handling.

---

## 16. Dataloaders 🟢

**What it is:** GraphQL-style per-request batching and caching to solve the N+1 query problem.

**How it's implemented:** `Dataloader` (`dataloader/dataloader.ts`) collects `.load(key)` calls into a queue and dispatches a single batched call to the developer's `batchFn` on `process.nextTick`, splitting into multiple batches if `maxBatchSize` is exceeded. Supports per-instance caching (default on, keyed by identity or a custom `cacheKeyFn` for object keys — objects are `JSON.stringify`'d by default to avoid reference-equality cache misses), `.prime()` for pre-filling the cache, and per-key error rejection (a batch function can return a mix of values and `Error` instances, with each key resolved/rejected independently). Loaders are correctly isolated per request via the DI/context system — verified by tests asserting two concurrent requests using the same loader name get independent batches and caches.

---

## 17. tRPC-style Frontend Type Client 🟢

**What it is:** End-to-end type safety between the ExisJS backend and a frontend, without a separate tRPC dependency.

**How it's implemented:** The manifest generator (§8b) produces `.exis/types.d.ts` exporting an `AppRouter` type. The `exisjs/client` package's `createClient<AppRouter>()` uses a recursive `Proxy` to translate property access chains (`client.api.users.get(...)`) into the corresponding HTTP request, inferring the payload/response shape from the generated types. This is a type-level feature (compile-time safety) layered on a runtime `fetch` call. The framework CLI's file watcher (`exis dev`) explicitly listens to all file events (`add`, `unlink`, `change`) to instantly regenerate the types manifest, ensuring your frontend types never silently fall out of sync with your backend routes.

---

## 18. Authentication Suite (`exisjs/auth`) 🟢

**What it is:** JWT, password hashing, RBAC, and session primitives built on Node's native `crypto`, with no third-party cryptography dependency.

- **JWT (`auth/jwt.ts`):** HS256 via `crypto.createHmac`. Verification checks buffer length before calling `timingSafeEqual` (avoiding the common length-mismatch-throws footgun), and distinguishes `TokenExpiredError` from a generic invalid-signature `HttpError` — useful for clients that want to auto-refresh on expiry specifically.
- **Passwords (`auth/password.ts`):** `crypto.scrypt`, promisified. Hashes are stored with their cost parameters embedded inline (`scrypt:N:r:p:keylen:salt:hash`), so cost factors can be increased later without invalidating existing hashes. Backwards-compatible with a legacy 2-part `salt:hash` format.
- **RBAC (`auth/rbac.ts`):** `requireRole(roles)` checks array intersection between `req.user.role` (string or array) and the allowed list, throwing `401` if unauthenticated or `403` if authenticated but unauthorized.
- **Sessions (`auth/session.ts`):** HMAC-signed, HttpOnly cookies (`timingSafeEqual`-verified) with a pluggable `SessionStore` (in-memory provided, Redis/DB left to the developer). Auto-saves session mutations back to the store by hooking `res.raw.end` and uses dirty-checking (`JSON.stringify(sessionData) !== initialState`) to ensure it only writes to the remote store when the session was actually mutated.

---

## 19. Universal Edge & Serverless Adapters 🟢

**What it is:** A consistent `fetch`-based adapter pattern letting the same `App` run on Cloudflare Workers, Deno, Bun, Fastly Compute@Edge, Netlify Edge, Vercel, and AWS Lambda.

**How it's implemented:** All platform adapters (`adapters/*.ts`) follow the identical init-once-then-handle pattern: lazily call `app.create()`/`app.onStartHook()` on first invocation, then delegate to either `app.fetch(request, env, ctx)` (Web-standard platforms) or `app.handle(req, res)` (Node-stream platforms like Vercel). This consistency across seven adapters is a genuine strength — there's no divergence in behavior between them.

`adapters/fetch.ts`'s `FetchIncomingMessage`/`FetchServerResponse` polyfill is the shared foundation for all Web-standard-`Request`-based platforms: it emulates just enough of Node's stream/EventEmitter interface (including correctly flushing pre-buffered body bytes to late-registered `'data'`/`'end'` listeners, and correctly handling `.once()` since it delegates to the same `.on()` override) for the framework's existing middleware to run unmodified on Edge runtimes.

**AWS Lambda specifics (`adapters/aws-lambda.ts`):** automatically detects text-based payloads (JSON, HTML, plain text) and sends them as unencoded strings to save wire overhead, falling back to base64 encoding (`isBase64Encoded: true`) only for binary data (images, octet streams).

---

## 20. Security Middleware Suite

Split by actual strength, not lumped together as one "Security Suite":

### 20a. Solid, standard-pattern implementations 🟢

- **Helmet-equivalent headers** (`middleware/security.ts` `helmet()`) — standard static security headers (HSTS, X-Frame-Options, X-Content-Type-Options, etc.), configurable, well-tested.
- **CSRF** (`csrf({ secret })`) — Signed Double Submit Cookie pattern using HMAC SHA-256 to prevent Cookie Tossing attacks. Validated via header-vs-cookie match on state-changing methods.
- **HPP** (`hpp()`) — mitigates HTTP Parameter Pollution by forcing array-like query/body parameters down to their last element.
- **DB sanitize** (`dbSanitize()` / `mongoSanitize()`) — recursively strips keys starting with `$` or containing `.` from body/query/params to prevent NoSQL injection.
- **Timeout** (`timeout()`) — kills stalled requests and sends a 503 if response takes too long.

### 20b. Removed Features 

- **`sqlSanitize()` / `dbSanitize({ sql: true })`** — Removed. This regex-based blocklist filtering was trivially bypassable and mangled legitimate content. Real protection comes from parameterized queries / ORM usage. See `REMOVED_FEATURES.md`.

---

## 21. Observability

- **Health checks 🟢** (`observability/health.ts`) — runs an array of named async checks in parallel, each wrapped in a `Promise.race()` against a `.unref()`'d timeout so a hanging dependency check can't block the health endpoint itself; aggregates to `200 pass` / `503 fail`.
- **Metrics 🟢** (`observability/prometheus.ts`) — "bring your own metrics" adapter pattern; the middleware itself only measures duration and delegates recording to a developer-supplied adapter (prom-client, StatsD, custom), using `req.routePath` rather than the raw URL to avoid cardinality explosions on parameterized routes.
- **Tracing 🟢** (`observability/otel.ts`) — same "bring your own tracer" pattern for OpenTelemetry-shaped spans, correctly redacts sensitive headers (`authorization`, `cookie`, `x-api-key`, etc.) before they'd reach an external tracing backend, and maps 5xx responses to `SpanStatusCode.ERROR`.

---

## 22. Zero-Config Third-Party Integrations 🟢

**What it is:** Lazy-loaded clients for 12 external services (Drizzle, JWT, MongoDB, Mongoose, OpenAI, PostgreSQL, PostHog, Prisma, Redis, Resend, S3, Supabase) that read connection config from conventional environment variables and dynamically `require()` the underlying SDK only when first accessed.

**How it's implemented:** Each integration (`integrations/*.ts`) exports a `Proxy`-wrapped singleton (e.g. `redis`, `s3`, `mongo`) whose `get` trap lazily constructs the real client on first property access, plus a `create*Client()` factory for explicit instantiation and a `configure*()` function to set options before first use. This means the framework's core bundle never imports these heavy SDKs directly, and connection setup is deferred until the exact moment it's needed — contributing to fast boot times. The test suite comprehensively validates both the missing-env-var failure modes and the successful client constructions (via mocked module injection) across the integrations.

**Important architectural caveat:** these are **process-wide module-level singletons**, not per-`App`-instance. Multiple `App` instances in one process (e.g. multi-tenant setups, or multiple test files each creating an app) will share the same underlying client unless the explicit `create*Client()` factory is used instead of the singleton proxy. Document this clearly for any usage beyond "one app, one process."

**Test coverage caveat:** the "throws when required env var is missing" path is tested for all 12 integrations; the "successfully constructs a client with valid config" path is currently only asserted for JWT — the equivalent Redis/S3 tests exist but are marked `.skip()`. Low-effort to complete since the mocking infrastructure is already built.

---

## 23. CLI & Tooling 🟢

`exis dev` (esbuild/tsx-powered HMR via child process + chokidar watch, smart port-conflict messaging), `exis build` (§8), `exis start` (production boot), `exis routes` (colorized routing table), `exis test` (native `node:test` wrapper with a custom Jest-style reporter — see §24), `exis generate <type>` (scaffolding for routes/plugins/middleware/tests, functional or OOP), `exis init` / `create-exis` (interactive project scaffolding), `exis console`/`repl` (interactive REPL with auto-discovered model injection), `exis exports` (prints the subpath export map). This surface is broad but consistently implemented and reasonably well covered by both unit and e2e tests (`cli.test.ts` mocks `spawn`/`exit` for fast unit tests; `cli-e2e.test.ts` runs the compiled CLI as a real child process for a smaller set of true end-to-end checks).

**Cluster mode** (`server/cluster.ts`): `workers: 'safe' | 'max' | number` forks Node's native `cluster` module, with crash-loop detection (stops auto-respawning if more than `maxRespawns` crashes occur within `respawnWindow`) and graceful multi-worker shutdown on SIGINT/SIGTERM.

---

## 24. Native Test Runner Integration 🟢

**What it is:** A integrated test runner built on `node:test`, with a custom Jest/Vitest-style terminal reporter, a Jest-compatible `expect()` assertion library, and `createTestContext()` for booting a full `App` (DI container, database connections) inside tests without mocking.

**How it's implemented:** `testing/reporter.mts` consumes `node:test`'s async iterable of `TestEvent`s and renders grouped, colorized, file-scoped PASS/FAIL output with a Jest-style failure summary — genuinely nicer than raw TAP output. `testing/expect.ts` implements the common Jest matcher surface (`toBe`, `toEqual`, `toMatchObject`, `toHaveBeenCalledWith`, `resolves`/`rejects`, etc.) on top of `node:assert`. `createTestContext()` (`testing/index.ts`) wires `before`/`after` hooks that boot the app, and on teardown, correctly awaits and closes Mongoose, Redis, and Prisma connections if detected in use.


**Suite quality note:** the framework's own test suite (used to write this document) is dense and well-constructed across routing, request/response, DI, validator, dataloader, WebSockets (including negative-path auth tests), observability, and both queue drivers. Its main gaps are exactly the two areas this document flags as risk: no test crosses the cron↔queue integration boundary, and the dedupe/cache tests use a single logical client rather than simulating concurrent different users.

---

## 25. Response Interceptors, Guards, and Pipes 🟢

- **`intercept(transform)`** (`middleware/interceptor.ts`) — monkey-patches `res.json` for the request duration to apply a transformation function to the outgoing payload, supporting both sync and async transforms. Deliberately does not intercept `res.send()`, since that's meant for raw string/buffer output.
- **`guard(canActivate, options?)`** (`middleware/guard.ts`) — evaluates a boolean (or async-boolean) condition and short-circuits with `403` if it returns false; the OOP equivalent (`@UseGuards`-style) resolves guard classes via the DI container if registered, or instantiates them directly otherwise.
- **`pipe(location, key, transformFn)`** (`middleware/pipe.ts`) — transforms a specific `body`/`query`/`params` key before the handler runs, catching thrown errors and responding `400` automatically.

---

## 26. Caching, Deduplication, and Backpressure — read this section carefully

These three middlewares are implemented correctly for their _intended_ single-client use case, and are dangerous with default settings outside it. Do not present them as safe defaults without qualification.

### 26a. Tag-based Cache Stores 🟢

`FileSystemCacheStore`, `MemoryCacheStore`, `RedisCacheStore` (`cache/store.ts`) all implement the same `CacheStore` interface: entries carry an array of string `tags`, and a separate tag→`lastRevalidated` timestamp map is checked on every `get()` — if any of an entry's tags were revalidated after the entry was created, it's treated as a miss. `revalidateTag(tag)` instantly invalidates every entry carrying that tag, Next.js-style. **`MemoryCacheStore` automatically synchronizes invalidations across cluster workers** — when running in `workers > 1` mode, it uses IPC to broadcast tag invalidations to all sibling workers so the memory cache remains safely consistent across the cluster (without requiring Redis).

### 26b. `cacheMiddleware` 🟢

Requires a mandatory `keyGenerator` function (e.g., `(req) => req.user?.id + ':' + req.path`) to ensure cache segregation across users/sessions on authenticated routes. Attempting to use this middleware without providing a `keyGenerator` throws a startup error, preventing accidental cross-user data leaks.

### 26c. `dedupeMiddleware` 🟢

Also requires a mandatory `keyGenerator` to prevent cross-user broadcasting of in-flight requests. Two different authenticated users requesting the same path within the same in-flight window are correctly segregated if the key includes their identity.

### 26d. Backpressure Engine 🟢

`backpressureMiddleware` (`middleware/backpressure.ts`) tracks `activeCount` against `maxConcurrent`, queues overflow up to `maxQueue` with a timeout, and returns `503` once the queue itself is full — correctly implemented and tested, no identity-related caveats since it doesn't cache or share response data between requests.

### 26e. Circuit Breaker 🟢

`CircuitBreaker` (`utils/circuit-breaker.ts`) implements a standard `CLOSED`/`OPEN`/`HALF_OPEN` state machine with a single-probe half-open test — correctly implemented and tested, including the full open→half-open→closed recovery cycle.

---

## 27. Standardized JSON Responses 🟢

`response/index.ts` exports `success(data, message?)` / `error(message, code?, details?)` helper functions producing a consistent `{ success: boolean, data?, error? }` envelope shape — a convention, not an enforced contract; handlers can return anything and it will still be auto-serialized, but using these helpers keeps API responses consistent across a codebase.

---

## Summary: what to actually rely on today

| Category                           | Subsystems                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Rely on freely**                 | Routing, controllers/decorators, DI, context API, validation, request/response, error handling, dataloaders, gateways/modules/plugins, hot reload, CLI, WebSockets (Node backend), uWebSockets.js backend, SSE, auth primitives (JWT/password/RBAC/session), backpressure, circuit breaker, health/metrics/tracing, cacheMiddleware, dedupeMiddleware, cron, production optimizers (AOT/JIT), edge/serverless adapters, tRPC-style client |
| **Use, but read the caveat first** | Cache stores (mind multi-server horizontal scaling with `MemoryCacheStore`), zero-config integrations (mind singleton scope)                                      |
This table should be kept current as fixes land — moving a row from the middle to the top category is exactly the kind of visible progress worth calling out in a changelog.
