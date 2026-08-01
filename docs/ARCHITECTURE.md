<h1 align="center">Framework Architecture & Implementation Details</h1>

This document serves as the master architecture reference for Exisjs. It details not only **what** the internal subsystems are, but exactly **how** they are implemented under the hood. This guarantees that as the framework scales, we never lose track of our architectural decisions.

---

## 1. File-System Routing

**What it is:** Folder-based routing mapping HTTP routes directly to the file system (`route.ts`, `schema.ts`, `controller.ts`, `service.ts`).
**How it's implemented:** The framework scans the `src/http` directory during boot and registers routes into a **custom, zero-allocation Radix Tree** (`RadixTree`). To maximize speed, the tree uses flat arrays (`staticChildren`) instead of Maps, and features a zero-heap-allocation fast path (`_staticWalk`) for static routes. It also integrates `fast-json-stringify` natively to compile `schema.response` into highly optimized serializers.

**Example**:

```typescript
// src/http/users/route.ts
import { controller, route } from 'exisjs/router'
export default controller({
  getSingle: route.get('/:id', {
    handle: ({ req, res }) => res.json({ id: req.params.id }),
  }),
})
```

---

## 2. Declarative Definitions

**What it is:** Type-safe configuration objects that replace standard imperative routing logic (`app.get()`).
**How it's implemented:** Provided by `exisjs/router` (`controller`, `route`). It lets users build strongly-typed dictionaries of handlers that the internal Router processes natively without bleeding implementation details into every file.

---

## 3. The Context API & Lifecycle

**What it is:** Eliminates prop-drilling by letting you access the request context (`req`, `res`, `user`) from anywhere in your codebase, plus deferred execution (`after()`).
**How it's implemented:** Powered natively by Node.js `AsyncLocalStorage`. ExisJS instantiates an `InternalContext` object storing `{ state, afterCallbacks, req, res, app }`. Methods like `getContext()` or `after()` simply tap into this context. After the response finishes sending, the server automatically flushes the `afterCallbacks` array asynchronously.

**Example**:

```typescript
import { getContext, after } from 'exisjs/router'
export async function createUser() {
  const { userId } = getContext() // Safely retrieve without passing req/res
  after(async () => console.log('Fired after response is fully sent!'))
}
```

---

## 4. Cascading Gateways

**What it is:** Folder-level encapsulation for Middleware, CORS, and Plugins.
**How it's implemented:** Handled natively by `gateway.ts` configurations. Developers can define gateways using the functional `defineGateway({})` API or the Object-Oriented `@Gateway({})` class decorator. During boot, the router maintains a stack of active gateway configs as it traverses directories. Routes deeper in the tree inherit and merge arrays of middleware from parent gateways. If a gateway returns a response, execution halts before reaching the route.

---

## 5. Native Validation Engine (`v`)

**What it is:** A built-in, Zod-like schema validator with a robust real-time data sanitization engine.
**How it's implemented:** Developed completely from scratch (`src/utils/validator.ts`) without external dependencies. It strictly parses types, aggregates a `ValidationError` array, and throws a specialized `ValidatorError`. Furthermore, it natively integrates a highly optimized Sanitization Engine (`src/utils/sanitize.ts`). Before validation checks are enforced, it mutates incoming payloads (applying `.trim()`, `.lowercase()`, `.escape()` for HTML entites, etc.) protecting business logic from dirty inputs effortlessly.

---

## 6. Dataloaders (N+1 Solution) (`exisjs/dataloader`)

**What it is:** Solves the N+1 query problem by batching database requests.
**How it's implemented:** Uses Node.js `process.nextTick`. When `.load(id)` is called, it adds the ID to an internal array and schedules a microtask. Once the tick resolves, it passes all collected IDs to the developer's batch function and distributes the resulting data back to the awaiting promises.

---

## 7. Encapsulated Plugins

**What it is:** Strictly isolated, plug-and-play modules that don't bleed into the global application.
**How it's implemented:** In `src/utils/plugin.ts`, `definePlugin` wraps the configuration into a factory function. When registered, Exisjs creates a Proxy of the `App` instance, intercepting `app.use()` and `app.get()` to apply them _only_ to a localized sub-router instead of the global application.

---

## 8. Zero-Config Database & Services

**What it is:** Lazy-loaded, zero-dependency clients for 12 external services.
**How it's implemented:** Integrations for Drizzle, JWT, MongoDB, Mongoose, OpenAI, PostgreSQL, PostHog, Prisma, Redis, Resend, S3, and Supabase are provided natively. They use a brilliant `Proxy` pattern with dynamic `require()` statements inside a `try/catch`. This means ExisJS does not actually bundle any of these heavy SDKs in its core dependencies. If a developer uses `supabase.from()`, the Proxy intercepts it, automatically reads `SUPABASE_URL` from the environment, and dynamically requires the SDK. If the SDK isn't installed, it throws a helpful `npm install` prompt. Crucially, because it's a Proxy, the database connection is entirely deferred until the exact millisecond of the first query, guaranteeing instantaneous server boot times.

---

## 9. Native Job Queues (`ExisWorker`)

**What it is:** A robust background task queue.
**How it's implemented:** Relies on Redis lists. The `ExisQueue` pushes JSON stringified payloads via `LPUSH`. The `ExisWorker` polls the keys concurrently using `LPOP`. If a job fails, the worker catches the error, increments `attemptsMade`, and uses `RPUSH` to re-queue the job until it hits the configured `maxAttempts`.

---

## 10. Built-in WebSockets & Pub/Sub

**What it is:** High-performance, native WebSockets with built-in Room subscriptions.
**How it's implemented:** The framework detects `uWebSockets.js` or falls back to native `ws`. The `ExisWebSocketServer` maintains a `Map<string, Set<ExisWebSocket>>` to enable instantaneous Pub/Sub room broadcasting (`socket.publish('room', data)`). It prevents memory leaks via an automated 30-second ping/pong heartbeat that is explicitly `.unref()`'d. WebSocket routes also reuse the exact same middleware chains as HTTP endpoints.

---

## 11. Request & Response Engine

**What it is:** Feature-rich wrappers for `req` and `res`.
**How it's implemented:**

- `ExisRequest` natively parses multipart data (files) via `busboy` and queries via `fast-querystring`. It natively handles `trustProxy` logic by unwrapping `x-forwarded-for`.
- `ExisResponse` features an automatic ETag generator and intercepts `req.fresh` to return `304 Not Modified` on unchanged assets automatically. Includes native `.download()`, `.html()`, and streaming wrappers.

---

## 12. Intelligent Hot-Reloading & Dep Graph

**What it is:** Instant, granular server hot-reloading that doesn't drop connections.
**How it's implemented:**

- **Dependency Graph:** `generateDependencyGraph` scans files with regex (`import ... from`) resolving aliases like `@/` to build a real-time graph of dependencies.
- **Hot Reloader:** Instead of rebooting Node.js, `chokidar` listens for file changes. If `users/service.ts` changes, it uses the Dependency Graph to find `users/route.ts`, clears `require.cache` for those specific files, removes the stale endpoints from the Radix Tree, and remounts the new functions dynamically.

---

## 13. uWebSockets.js Adapter

**What it is:** An auto-detecting proxy layer that upgrades the server to C++.
**How it's implemented:** When `uWebSockets.js` is installed, Exis injects `UwsIncomingMessage` and `UwsServerResponse` shims (`src/server/uws-adapter.ts`). These emulate standard Node streams flawlessly. **Crucially**, it leverages `res.cork()` internally to batch headers, status, and body data into a single C++ syscall to achieve maximum possible I/O throughput. Because uWS objects are invalidated after the first synchronous tick, Exis copies headers safely beforehand.

---

## 14. Developer Error Overlay

**What it is:** Beautiful, visual syntax and runtime errors in the terminal.
**How it's implemented:** `parseErrorLocation` shreds V8 stack traces to isolate the exact failing file, line, and column. `buildCodeFrame` then reads the file system to print a syntax-highlighted code excerpt with a `> ` pointer exactly where the crash occurred (`src/server/dev-error-overlay.ts`).

---

## 15. Circuit Breaker (`src/utils/circuit-breaker.ts`)

**What it is:** Protects external services from cascading failures.
**How it's implemented:** Implements a strict State Machine (`CLOSED`, `OPEN`, `HALF_OPEN`). When `failureThreshold` is reached, it trips to `OPEN`. After `resetTimeoutMs`, it switches to `HALF_OPEN` to test a single probe request before recovering.

---

## 16. Environment Loader (`src/utils/env.ts`)

**What it is:** Intelligent `.env` loading, strict validation, and auto-bootstrapping.
**How it's implemented:** Uses `dotenv` and `dotenv-expand` to cascade overrides (`.env.local` > `.env`). The framework's core bootstrapper (`start-server.ts`) natively executes `loadEnv()` right at boot, reading the `.env` file and merging it directly into Node.js's global `process.env`. This means developers do _not_ need to import `dotenv/config` in their files—they can instantly use `process.env.MY_VAR` anywhere natively. Additionally, it scans for an `env.ts` file and auto-imports it. Developers can use `v.env(schema)` inside `env.ts` to strictly validate `process.env` at startup, instantly crashing the server if critical variables are missing.

---

## 17. High-Performance Logging (`src/utils/logger.ts`)

**What it is:** Asynchronous, non-blocking JSON logging.
**How it's implemented:** Wraps `pino` to bypass Node's native `console.log` bottlenecks. It implements automatic secret redaction natively.

---

## 18. Dynamic Configuration (`src/utils/config.ts`)

**What it is:** Resolves the `exis.config.ts` file.
**How it's implemented:** Uses the `Function('specifier', 'return import(specifier)')` hack to bypass TypeScript's aggressive CommonJS transpilation, allowing native dynamic `import()`.

---

## 19. Global Error Handling (`src/utils/errors.ts`)

**What it is:** Global, unhandled exception interception.
**How it's implemented:** Exposes an `HttpError` factory. Intercepts all routes, formatting a JSON response (`success: false, error: ...`). If the client `Accepts: text/html`, it returns a styled HTML stack trace natively.

---

## 20. Advanced CLI & Generators

**What it is:** The `exis` CLI (`dev`, `build`, `start`, `routes`, `generate`).
**How it's implemented:** Powered by `commander`. 
- The `build` command natively embeds **Esbuild** to compile TypeScript to highly optimized JavaScript instantaneously, dropping the slow `tsc` dependency. 
- The `dev` command incorporates a smart Port Detection algorithm: if the requested port (e.g., `3000`) is bound by another process, it automatically increments and binds to the next available port without crashing `EADDRINUSE`.
- The `routes` command prints a beautiful color-coded table of all API endpoints and their middleware counts.

---

## 21. Native Health Checks

**What it is:** A robust `/health` endpoint for Kubernetes and load balancers.
**How it's implemented:** The `healthCheck` middleware (`src/observability/health.ts`) executes an array of asynchronous dependency checks. Crucially, it wraps each check in a `Promise.race()` against a `.unref()`'d timeout, preventing hanging database connections from blocking the health check. It aggregates the results and automatically returns `200 pass` or `503 fail`.

---

## 22. BYOM / BYOT Observability (Metrics & Tracing)

**What it is:** Dependency-free adapters for Prometheus, StatsD, and OpenTelemetry.
**How it's implemented:**

- **Metrics (`prometheus.ts`)**: Uses a 'Bring Your Own Metrics' approach. It intercepts requests and hooks into `res.raw.once('finish')` to calculate `durationMs`. It intelligently uses `req.routePath` (e.g., `/users/:id`) rather than the raw URL (`/users/123`) to prevent metrics cardinality explosions.
- **Tracing (`otel.ts`)**: Uses a 'Bring Your Own Tracer' adapter. It automatically starts an active span, listens for the response finish, and maps HTTP status codes > 500 directly to OpenTelemetry's internal `SpanStatusCode.ERROR` (code: 2) before ending the span.

---

## 23. Active Backpressure Engine

**What it is:** Prevents the server from crashing under extreme load (DDoS or traffic spikes).
**How it's implemented:** Tracks an `activeCount`. If it exceeds `maxConcurrent`, incoming requests are pushed to a `queue`. If the queue hits `maxQueue`, it instantly throws a `503 Service Unavailable`. Parked requests have a `.unref()`'d timeout to drop them if they wait too long. It cleverly hooks into `res._onFinish` to decrement the active count and process the next queued request asynchronously via `process.nextTick`.

---

## 24. Request Deduplication (Thundering Herd Protection)

**What it is:** Prevents identical simultaneous requests from destroying the database.
**How it's implemented:** If 100 users request the exact same cache-missed URL at the exact same millisecond, `dedupe.ts` intercepts them. It allows the _first_ request to proceed and parks the other 99 in a Map. When the first request resolves, it intercepts the `res.send()` buffer, copies the headers, and natively broadcasts the exact same buffer to the 99 parked response sockets simultaneously.

---

## 25. Interceptor Caching

**What it is:** High-speed route caching.
**How it's implemented:** Intercepts `res.send` and `res.json`. On a cache miss, it wraps the send functions to asynchronously write the response body, headers, and status code to the `CacheStore` in the background (`Promise.resolve(store.set(...)).catch(...)`), while simultaneously returning the response to the user so they don't have to wait for the Redis write. On a cache hit, it reconstructs Buffers and fires instantly.

---

## 26. Streaming Compression

**What it is:** Native Brotli, Gzip, and Deflate.
**How it's implemented:** Wraps `res.raw.write` and `res.raw.end`. It drops the `Content-Length` header (since compressed size is unknown beforehand) and creates a native Node.js `zlib` stream. It pipes all chunked raw writes through the compression stream before sending them to the native socket.

---

## 27. Advanced Security Suite

**What it is:** Standard security patterns and middleware built on Node's native primitives to protect against XSS, CSRF, NoSQL Injection, and Parameter Pollution.
**How it's implemented:**

- **Helmet**: Sets static HTTP headers (`Strict-Transport-Security`, `X-XSS-Protection`).
- **CORS Preflight Logging**: Intercepts `OPTIONS` requests natively. If a preflight request from a browser is rejected because the origin is disallowed, the framework transparently logs a `WARN` via Pino, ending the silent failures typical of browser CORS issues.
- **CSRF**: Uses the Double Submit Cookie pattern. Drops a random UUID cookie on safe requests and validates that state-changing requests echo it back in a header.
- **XSS & Mongo Sanitize**: Recursively traverses `req.body`, `req.query`, and `req.params` to escape HTML tags or strip MongoDB `$ ` operators.
- **HPP**: Normalizes arrays in queries by picking the last element to prevent Parameter Pollution crashes.

---

## 28. Standardized JSON Responses

**What it is:** Enforces strict API contracts.
**How it's implemented:** `src/response/index.ts` provides utility functions (`success()` and `error()`) that format every framework response into a predictable `{ success: boolean, data?: T, error?: {...} }` structure.

---

## 29. O(1) Production Boot (Manifest Generation)

**What it is:** Eliminates slow file-system scanning in production.
**How it's implemented:** Instead of recursively using `fs.readdir` to scan the `src/http` directory at startup, `exis build` (`cli/manifest.ts`) statically analyzes the routing tree and compiles a flat `.exis/routes-manifest.js` file. In production, ExisJS just requires this single flat array, giving it instantaneous `O(1)` boot times.

---

## 30. Native V8 Memory Monitor

**What it is:** Prevents catastrophic Out-of-Memory (OOM) crashes in production.
**How it's implemented:** The internal server entry point (`lib/start-server.ts`) initializes an unref'd `setInterval` that natively polls `v8.getHeapStatistics()`. If heap usage exceeds 80% of the limit, it triggers a clean `process.exit(143)` (SIGTERM). This gracefully signals process managers like PM2 or Kubernetes to safely restart the instance _before_ it hangs and drops traffic.

---


## 31. Tag-based Cache Stores (`exisjs/cache`)

**What it is:** Next.js-style cache tagging and revalidation.
**How it's implemented:** The framework provides `FileSystemCacheStore`, `MemoryCacheStore`, and `RedisCacheStore`. Cache entries are stored with an array of string `tags`. The store maintains a separate lookup dictionary mapping `tags` to a `lastRevalidated` timestamp. When `cache.get(key)` is called, it checks if any of the item's tags have a timestamp _newer_ than the item's `createdAt` time. If so, it returns `null` (cache miss), forcing the app to re-fetch the data. This allows developers to instantly invalidate millions of cached routes with a single `revalidateTag('users')` call.

---

## 32. Strict Subpath Exports (`exisjs/*`)

**What it is:** Clean architectural boundaries and perfectly organized module scopes via `package.json` exports mapping.
**How it's implemented:** The `package.json` explicitly maps `exports` to specific domain paths, keeping the public API surface pristine and discoverable. The CLI command `exis exports` dynamically prints this perfectly categorized table:

- **🚀 Core Framework**: `exisjs` (App, cors, helmet), `exisjs/router`, `exisjs/module`, `exisjs/di`, `exisjs/decorators`, `exisjs/middleware`
- **⚙️ Built-in Subsystems**: `exisjs/auth`, `exisjs/cache`, `exisjs/queue`, `exisjs/testing`, `exisjs/validator`, `exisjs/dataloader`, `exisjs/observability`, `exisjs/swagger`
- **🛠️ Utilities**: `exisjs/config`, `exisjs/error`, `exisjs/plugin`, `exisjs/response`, `exisjs/security`, `exisjs/circuit-breaker`
- **🔌 Integrations**: `exisjs/drizzle`, `exisjs/postgres`, `exisjs/redis`, `exisjs/openai`, `exisjs/s3`, etc.
- `exisjs/cache`: `getCacheStore`, `revalidateTag`
- `exisjs/config`: `loadConfig`, `defineConfig`
- `exisjs/auth`: `signJWT`, `verifyJWT`, `hashPassword`
- `exisjs/supabase`, `exisjs/postgres`, `exisjs/redis`, etc., for integrations.

---

## 33. Native Authentication Suite (`exisjs/auth`)

**What it is:** Authentication suite built strictly on Node's native crypto primitives (no custom cryptography).
**How it's implemented:**

- **JWT (`jwt.ts`)**: Generates and verifies standard HS256 JWTs using Node's native `crypto.createHmac`. It natively throws `TokenExpiredError` if the payload's `exp` is in the past, and uses `timingSafeEqual` to prevent timing attacks.
- **Passwords (`password.ts`)**: Uses Node's asynchronous `crypto.scrypt` wrapped in a Promise. It stores hashes defensively with all parameters embedded (`scrypt:N:r:p:keylen:salt:hash`) ensuring hashes can still be verified if cost parameters change in the future.
- **Role-Based Access Control (`rbac.ts`)**: Native middleware `requireRole(['admin'])` that checks array intersections against `req.user.role`.
- **Sessions (`session.ts`)**: Creates signed, HttpOnly cookies. It transparently intercepts `res.raw.end` to automatically save `req.session` mutations back to the active `SessionStore` at the end of the request, meaning developers never have to manually call `.save()`.

---

## 34. Universal Edge & Serverless Adapters (`exisjs/adapters`)

**What it is:** Deploy ExisJS to any platform, including V8 Isolates (Cloudflare Workers) and Serverless environments (AWS Lambda, Vercel).
**How it's implemented:** The core Exis engine is heavily optimized around native Node.js HTTP streams (`IncomingMessage` and `ServerResponse`). To run on WinterCG-compliant Edge networks:

- **`fetch.ts` Polyfill**: It takes standard Web `globalThis.Request` objects and polyfills an `EventEmitter` that mocks an `IncomingMessage` stream. It intercepts the `res.write` and `res.end` calls to compile the data back into a standard `globalThis.Response`. This allows the _entire_ complex Exis middleware ecosystem (which relies heavily on stream manipulation) to run flawlessly on Edge runtimes.
- **V8 Isolates**: `bun.ts`, `deno.ts`, `cloudflare.ts`, and `fastly.ts` all hook directly into `app.fetch(request, env, ctx)` leveraging this polyfill.
- **Serverless**: `aws-lambda.ts` converts API Gateway JSON events into mock HTTP streams, while `vercel.ts` directly consumes Vercel's native Node.js HTTP streams, advising developers to use `export const config = { api: { bodyParser: false } }` to ensure pristine stream delivery.

---

---

## 35. Project Scaffolding CLI (`create-exis`)

**What it is:** A dedicated bootstrapping tool (e.g. `npm create exis`) similar to `create-next-app`.
**How it's implemented:** Lives in `packages/create-exis/`. It provides an interactive terminal UI (powered by `prompts`) to guide developers through setting up a new ExisJS project.

- **Customizable Setup:** Asks the developer whether they want to use TypeScript, ESLint, import aliases (`@/*`), and a `src/` directory.
- **Automated Bootstrapping:** Automatically generates `exis.config.ts`, the correct `tsconfig.json`, base `server.ts`, and initial `route.ts` handlers.
- **Smart Dependency Installation:** Detects the user's package manager (`npm`, `yarn`, `pnpm`, `bun`) from the `npm_config_user_agent` environment variable and automatically installs the core `exisjs` package and devDependencies.

---

## 36. Automated OpenAPI / Swagger Generation

**What it is:** Zero-configuration API documentation that stays perfectly in sync with your codebase.
**How it's implemented:** By calling `serveSwagger(app)` during boot, ExisJS traverses the internal `O(1)` routing tree. It automatically maps runtime route configurations (like `/:id` parameters) into OpenAPI 3.0 path definitions (`/{id}`). Furthermore, it intercepts the internal validation schemas attached to endpoints (Body, Query, Params) and dynamically serializes them into strict OpenAPI JSON Schema representations. This exposes a fully interactive Swagger UI without developers needing to manually write duplicate YAML or JSON definitions.

---


## 37. Esbuild Native HMR (Hot Module Replacement)

**What it is:** Ultra-fast, state-preserving developer reloads that never drop active WebSocket connections or memory caches.
**How it's implemented:** ExisJS completely circumvents the legacy Node.js strategy of shutting down the entire HTTP server on every file save.

- The `exis dev` command is natively powered by **Esbuild** (via `tsx`).
- Inside the server, a custom `HotReloader` monitors the `src/` directory and builds a living `DependencyGraph` of your AST imports.
- When you edit a controller, the Reloader computes all downstream route files, surgicaly invalidates `require.cache`, and uses the `Router`'s internal memory API to seamlessly swap out the old endpoint with the newly compiled one.
- The result: Your server stays alive. WebSockets remain connected. State is preserved. Changes appear instantly.

---

## 38. Native Background Jobs & Thread Pool

**What it is:** A deeply integrated Node.js Worker Thread pool that executes heavy, synchronous backend jobs without blocking your main event loop.
**How it's implemented:**

- Instead of using `bullmq` or `piscina`, ExisJS provides a zero-dependency Thread Pool (`ThreadPool`).
- Jobs are natively discovered from the `src/jobs/` directory on boot.
- The `ExisWorker` listens to a Redis queue. When a job is popped, instead of executing on the main thread, it securely hands the execution off to an isolated V8 background core.

---

## 39. Native Cron Scheduler

**What it is:** A zero-dependency scheduler to run tasks like database cleanups on a strict recurring schedule.
**How it's implemented:**

- You define `cron: '0 0 * * *'` directly inside your `defineJob` export in `src/jobs/`.
- The internal `CronScheduler` precisely ticks every 60 seconds, using a custom native cron parser to match expressions.
- Upon matching, it uses a Redis `SETNX` lock (expiring in 55s) to guarantee the cron job is executed **exactly once**, even if you have 100 horizontal API servers running simultaneously!

---

## 40. Native Server-Sent Events (SSE) Streaming

**What it is:** The industry standard for one-way streaming (like ChatGPT's text generation), natively built into the `Router`.
**How it's implemented:**

- You simply define an `sse:` handler in your route file: `sse: async (stream, req) => {}`.
- ExisJS automatically intercepts the request, applies standard headers (`text/event-stream`, `keep-alive`), and upgrades the connection.
- You can simply call `stream.send({ text: "Hello" })` or `stream.send("Chunk")` and ExisJS handles the strict SSE payload formatting natively.
- Full middleware support is retained (so you can easily use JWTs to protect AI streams).

---

## 41. Native File Uploads & Multipart Parser

**What it is:** A blazing fast, zero-configuration parser that magically makes uploaded files available in your HTTP routes. No need to install `multer` or `busboy`.
**How it's implemented:**

- When ExisJS detects a `multipart/form-data` request, it automatically streams the underlying binary data into highly optimized buffers.
- Normal text fields (like `username`) are parsed cleanly into `req.body` as you'd expect.
- Uploaded files are extracted into a heavily typed array of `ExisFile` objects available at `req.files`.
- You can immediately save them to disk using `fs.writeFileSync` or upload the `file.data` buffer directly to AWS S3 without writing to disk!

---

## 42. tRPC-style Frontend Type Client

**What it is:** Perfect, end-to-end type safety for the frontend without installing tRPC or configuring complex build steps.
**How it's implemented:**

- **Automatic Type Generation**: During development or build, the Exis CLI (`manifest.ts`) automatically scans all your `route.ts` files and dynamically generates a hidden `.exis/types.d.ts` file exporting an `AppRouter` type that contains all your API's schemas.
- **The Proxy Client**: The framework ships with a lightweight `exisjs/client` package. The frontend uses `createClient<AppRouter>({ baseUrl })`.
- **Magic Invocation**: When the developer types `client.api.users.get(payload)`, a recursive JavaScript `Proxy` intercepts the object properties, magically constructs the URL `/api/users`, appends the HTTP method `GET`, merges any global headers (like Authentication tokens), and executes the native `fetch` command. The IDE perfectly infers the payload shape and response type natively.

---

## 43. Functional Dependency Injection (DI) & Providers

**What it is:** A lightweight, decorator-free Inversion of Control (IoC) container embedded natively into the framework.
**How it's implemented:**

- **Container (`src/di/container.ts`)**: The core registry that lazily evaluates and securely caches value, factory, and class providers as singletons.
- **Global App Integration (`src/server/app.ts`)**: The container is instantiated on the `App` instance, allowing developers to define global dependencies via `app.provide(token, provider)`.
- **Contextual Injection (`src/di/inject.ts`)**: Using ExisJS's `AsyncLocalStorage` context (`src/server/context.ts`), developers can call `inject(token)` inside any route handler or middleware. It securely retrieves the active `App` instance and resolves the dependency synchronously, eliminating the need for complex `@Injectable()` decorators or constructor drilling.

---

## 44. Functional Response Interceptors

**What it is:** A native, lightweight `intercept()` middleware that allows developers to seamlessly mutate payloads before they hit the network stream.
**How it's implemented:**

- **Monkey Patching (`src/middleware/interceptor.ts`)**: The interceptor temporarily hijacks `res.json` and `res.send` for the duration of the request. When a route completes, it executes the developer's synchronous or asynchronous transformation function.
- **Universal Support**: Because the ExisJS router inherently passes returned values through `res.json`, the interceptor captures both imperative responses (`res.send()`) and declarative functional returns automatically. It fully supports `Promise`-based transformations to fetch extra data post-execution.

---

## 45. Exception Filters (`catchError`)

**What it is:** A native utility to catch and format specific classes of exceptions, acting as a functional alternative to NestJS's `@Catch()` decorators.
**How it's implemented:**

- **Filter Factory (`src/middleware/exception-filter.ts`)**: ExisJS natively identifies any middleware function with 4 arguments `(err, req, res, next)` as an error handler. The `catchError(errorClass, handler)` factory simply returns a 4-argument middleware that intercepts the global error pipeline.
- **Conditional Execution**: Inside the pipeline, if the thrown error matches the `errorClass` (via `err instanceof errorClass`), the custom formatting logic is executed. Otherwise, it gracefully falls through to the next error handler by calling `next(err)`.

---

## 46. Modular Architecture

**What it is:** The "perfect blend" of traditional NestJS module design (`@Module`) with modern File-Based Routing. It allows developers to completely decouple domain logic (e.g. Users, Database, Auth) while seamlessly integrating with the directory structure without manual registration boilerplate.
**How it's implemented:**

- **Explicit Modules (`defineModule`)**: Returns a highly optimized `Plugin` that effortlessly groups Providers and Imports (other modules), automatically deduplicating shared singletons before exposing them to the Dependency Injection framework. Can be loaded manually via `app.register(module)`.
- **File-Based Modules (`defineGateway`)**: Transforms any `gateway.ts` file in your route directory into a fully-fledged Module. The ExisJS router automatically discovers the file, parses its `imports` and `providers`, and seamlessly hydrates the application container BEFORE executing any `route.ts` inside that folder. Routes naturally `inject()` these providers as if they were globally initialized, delivering the cleanest possible architecture.

---

## 47. Guards & Pipes (Functional Implementation)

**What it is:** The functional equivalent to NestJS `@UseGuards()` and `@UsePipes()`, bringing enterprise Authorization and Data Transformation to a blazing-fast router.
**How it's implemented:**

- **Guards (`guard`)**: Evaluates a boolean condition (e.g., role-checking, authentication) and prevents execution of the handler if the condition returns `false`, throwing a `403 Forbidden` response.
- **Pipes (`pipe`)**: Intercepts the request (specifically the `body`, `query`, or `params`) and applies a transformation function to mutate the data safely before it reaches the handler.
- **How to use them**: Because ExisJS relies on a functional array-based pipeline, you can simply drop `guard()` and `pipe()` directly into the route array:
  ```typescript
  get: [
    guard((req) => req.headers.authorization === 'secret', {
      message: 'Unauthorized',
    }),
    pipe('params', 'id', (val) => Number(val)),
    (req, res) => res.send('Success!'),
  ]
  ```

---

## 48. Strict Response Typing (`InferSchemaResponse`)

**What it is:** Strongly-typed API responses strictly inferred from validation schemas and magically typed directly on `res.json()`.
**How it's implemented:** The framework intercepts the custom Zod-like response validation schema (`{ response: v.object({ ... }) }`) and exposes a new `InferSchemaResponse` type constraint. The route definitions (`route.get`, `route.post`, etc. inside `controller()`) automatically inherit this type and inject it natively into the `TResponse` generic of the executing `Handler`. Consequently, TypeScript intelligently limits `res.json(data)` and direct `return { ... }` handlers strictly to the predefined shape of the response schema.

---

## 49. Class-Based Decorators

**What it is:** A modern, incredibly fast implementation of `@Server()`, `@Gateway()`, and `@Controller()` decorators that totally avoids the bloated `reflect-metadata` polyfills of older frameworks.
**How it's implemented:**

- Uses standard TS 5.0+ decorators alongside legacy compatibility wrappers.
- Instead of using slow `Reflect.defineMetadata`, it binds raw JavaScript Symbols directly to class prototypes (`Symbol.for('exisjs:routes')`, `Symbol.for('exisjs:server_config')`, `Symbol.for('exisjs:gateway_config')`, etc.) ensuring O(1) instantaneous metadata lookup.
- Includes a robust set of routing decorators (`@Get`, `@Post`, `@Connect`, `@Trace`, `@Query`, etc.) and a powerful `@Use()` decorator that elegantly attaches middleware arrays to entire classes or individual methods natively.
- **Native WS & SSE Support:** Integrates perfectly with the framework's modernized streaming protocols. By applying the `@Ws('/path')` or `@Sse('/path')` decorators alongside the specialized `@Socket()` and `@Stream()` parameter injectors, developers can securely hijack the HTTP pipeline, bypass restrictive middleware defaults, and orchestrate real-time `ExisWebSocket` and `ExisSSE` interactions natively inside class architectures.
- The central Application context seamlessly discovers controllers with `app.registerControllers()`, auto-hydrates instances via Dependency Injection (`this.container.resolve()`), applies global prefixing via `@Controller('users')`, deeply merges class and method middlewares, and binds everything back into the hyper-fast Radix router automatically.
- **File-System Integration:** You can totally ditch manual registration by simply doing `export default class MyController { ... }` directly inside a file-system `route.ts`, or using `@Server()` in `server.ts` and `@Gateway()` in `gateway.ts`! The framework automatically discovers the classes, instantiates them via DI, and safely maps their decorators under the file's auto-generated namespace.

---

## 50. Native Test Runner Integration

**What it is:** A blazing-fast, integrated test runner leveraging Node.js's native `node:test` module.
**How it's implemented:**

- **Zero-Dependency CLI (`exis test`)**: Bypasses heavy frameworks like Jest or Vitest. It utilizes `node:test` under the hood.
- **Custom Reporter (`exisjs/testing`)**: Includes a native AsyncGenerator reporter that intercepts standard Node test events, buffering output to deliver a clean, Jest-like summary in the console (`PASS  Exis Framework tests/book.test.ts`), completely removing the default raw TAP output.
- **Booting and DI Integration**: Allows tests to seamlessly instantiate `app.create()` to initialize the database and DI container, enabling flawless integration tests against the database without mocking.
- **Test Generation**: The `exis generate test <name>` command natively scaffolds unit tests to ensure immediate high test coverage.

---

## 51. Environment Validation (`env.ts`)

**What it is:** Instantaneous, schema-driven validation of `process.env` at startup.
**How it's implemented:**

- The CLI automatically generates an `env.ts` file upon initialization that runs `v.env(...)`.
- This `env.ts` file is then natively imported directly into `exis.config.ts`.
- Because `exis.config.ts` is the first file the framework loads, if an environment variable is missing (like `DATABASE_URL`), the framework instantly halts boot and logs a beautiful `Environment Validation Failed` error.
- It elegantly separates environment schema definitions from the framework config, while giving developers a fully type-safe `env` object to use throughout their configuration.

---

## 52. Interactive CLI Initialization (`exis init`)

**What it is:** An interactive, prompt-based scaffolding wizard seamlessly available in existing projects.
**How it's implemented:**

- While `npx create-exis` bootstraps a new folder, `exis init` intelligently targets the current directory.
- It dynamically resolves the framework version (to prevent version skew) and safely spawns the exact corresponding version of `create-exis`.
- This perfectly mirrors the setup experience whether you're creating a new repository or configuring an existing blank Node.js folder, generating all necessary artifacts like `exis.config.ts`, `env.ts`, `tsconfig.json`, and `.gitignore`.

---

## 53. Functional Parity (Exception Filters, Pipes, Uploads)

**What it is:** Identical advanced Developer Experience (DX) natively available inside the `controller()` and `route.post()` functional APIs without relying on class decorators.
**How it's implemented:**
- **Pipes:** The router inherently inspects schemas passed to `body`, `query`, and `params`. If it detects a Pipe (a class or instance with a `.transform()` method), it resolves it instantly and applies data transformations automatically before the handler.
- **Exception Filters:** By attaching a `filters: [FilterClass]` array locally inside the route config or globally in the `controller()` config, ExisJS wraps the validation pipeline and handler in a localized error catcher, intelligently delegating failures to custom formatters instead of throwing 500s.
- **File Uploads:** Natively tied into the router's middleware execution pipeline. If `body: v.any()` is declared (or a specific validation schema) on a functional route receiving `multipart/form-data`, the underlying `busboy` engine automatically extracts binary streams and exposes them reliably on `req.files`.
- **Arrays of Hosts:** Allows routing to automatically intercept an array of domains natively inside `route.get('/path', { host: ['api.com', 'admin.com'] })`.

