# Changelog

All notable changes to the ExisJS framework monorepo are documented here and in modular release files under [`changelog/`](./changelog/).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Release Directory & Navigation

| Version | Release Date | Type | Key Highlights | Detailed Notes |
| :--- | :--- | :--- | :--- | :--- |
| **`v0.7.14`** | 2026-10-05 | Stability & Hardening | Windows path quoting fix for `exis run`, FS route specificity sorting, binary/stream `res.download()`, Windows libuv shutdown `UV_HANDLE_CLOSING` & `EPIPE` resolution, type inference strictness | [**Read v0.7.14 Notes →**](./changelog/v0.7/v0.7.14.md) |
| **`v0.7.13`** | 2026-10-02 | Feature & Engine Upgrades | `tex.discriminatedUnion`, schema composition (`extend`, `merge`, `pick`, `omit`), field/schema `transform`, `tex.coerce` primitives, multi-validator OpenAPI 3.1 translation | [**Read v0.7.13 Notes →**](./changelog/v0.7/v0.7.13.md) |
| **`v0.7.12`** | 2026-10-02 | Alignment & Patch | Automatic boot database connection (`DatabaseManager.connectAll()`), health check dual callback (`isHealthy` & `healthCheck`), docs sync, template update | [**Read v0.7.12 Notes →**](./changelog/v0.7/v0.7.12.md) |
| **`v0.7.11`** | 2026-10-01 | Performance & DX | Static route fast path (>51k req/s), lazy AbortSignal, uWS adapter event parity, `timingSafeEqual`, configurable `dev` watcher, flexible `registerDatabase`, `create-exisjs` cron scaffolding | [**Read v0.7.11 Notes →**](./changelog/v0.7/v0.7.11.md) |
| **`v0.7.10`** | 2026-09-27 | Feature & Resilience | Controller inheritance, property `@Inject`/`@Optional`, `forwardRef` circular DI, parameter transformation pipes, `@Global()` modules, DI parameter reflection, Mongoose/BSON safe serializer, query type coercion, error envelope standardization, CDN IP resolution | [**Read v0.7.10 Notes →**](./changelog/v0.7/v0.7.10.md) |
| **`v0.7.9`** | 2026-09-24 | Feature & Architecture | Enterprise OOP upgrades (Security, Caching, Transactions, Profiling, Lifecycles, Filters), ESM alias fix | [**Read v0.7.9 Notes →**](./changelog/v0.7/v0.7.9.md) |
| **`v0.7.8`** | 2026-09-22 | Patch & Export Fixes | Subpath export `exisjs/swagger`, root exports, canonical doc fixes | [**Read v0.7.8 Notes →**](./changelog/v0.7/v0.7.8.md) |
| **`v0.7.7`** | 2026-09-22 | Features & Architecture | Native Swagger/OpenAPI 3.1, subsystem modularization, comprehensive TSDoc | [**Read v0.7.7 Notes →**](./changelog/v0.7/v0.7.7.md) |
| **`v0.7.6`** | 2026-09-21 | Stability, DX & Perf | Response toolkit, actionable error envelopes, single-line logger, `tex.env` | [**Read v0.7.6 Notes →**](./changelog/v0.7/v0.7.6.md) |
| **`v0.7.5`** | 2026-09-19 | Resilience & DX | Error convention, boundary hooks, AbortSignal, CHIPS, instant shutdown | [**Read v0.7.5 Notes →**](./changelog/v0.7/v0.7.5.md) |
| **`v0.7.4`** | 2026-09-11 | Features & Validations | Diagnostic table, declarative uploads, route timeouts, nested arrays | [**Read v0.7.4 Notes →**](./changelog/v0.7/v0.7.4.md) |
| **`v0.7.3`** | 2026-09-09 | Features & Rust Perf | Native Rust Brotli/Gzip, realtime SSE streaming, `exis routes` & `doctor` CLI | [**Read v0.7.3 Notes →**](./changelog/v0.7/v0.7.3.md) |
| **`v0.7.2`** | 2026-09-06 | Bug Fixes & DX | TypeScript route param inference, runtime aliases, ESM relative fixes | [**Read v0.7.2 Notes →**](./changelog/v0.7/v0.7.2.md) |
| **`v0.7.1`** | 2026-09-06 | OOP & Logging | Full OOP parity decorators, DI scopes, `@Use(...)` unification, Pino logger | [**Read v0.7.1 Notes →**](./changelog/v0.7/v0.7.1.md) |
| **`v0.7.0`** | 2026-09-06 | Major Architecture | Monorepo decoupling, `boundary.ts` pipeline, native Rust `tex` validator | [**Read v0.7.0 Notes →**](./changelog/v0.7/v0.7.0.md) |

---

## Current Release: [0.7.14] - 2026-10-05

> For full technical details and code examples, see [**`changelog/v0.7/v0.7.14.md`**](./changelog/v0.7/v0.7.14.md).

### Added
- **Enhanced Binary, Buffer & Stream `res.download()` Response Helper**: Extended `res.download()` on `ExisResponse` to handle Buffers, Node.js Readable streams, Web ReadableStreams, strings, and file paths with automatic `Content-Disposition` and `Content-Type` header setting.

### Fixed
- **Windows Path Quoting & Space Handling in Subprocess Spawning (`exis run` / `exis exec`)**: Configured direct Node execution to use `shell: false` and `windowsHide: true`, resolving `C:\Program is not recognized` failures when Node is installed in directories containing spaces.
- **File-System Route Specificity & Radix Tree Segment Ordering**: Updated directory scanner to prioritize static paths over dynamic wildcard `[id]` and catch-all `[...slug]` segments, eliminating route shadowing.
- **Windows Libuv Shutdown Assertion & `write EPIPE`**: Safely disconnected active IPC channels via `process.disconnect()` prior to tearing down database pools and HTTP handles, suppressing broken pipe errors on exit and preventing `!(handle->flags & UV_HANDLE_CLOSING)` crashes.
- **Type Resolution Strictness**: Fixed optional/nullable type markers in `TexEngine` and route definitions to prevent unexpected union type collapsing.

---

## Previous Release: [0.7.13] - 2026-10-02

### Added
- **`tex.discriminatedUnion` Polymorphic Schema Branching**: First-class polymorphic schema validation matching literal/enum discriminant tags across sync/async parsing with OpenAPI 3.1 `oneOf` and `discriminator` generation.
- **`tex` Schema Composition (`extend`, `merge`, `pick`, `omit`)**: Added `.extend()`, `.merge()`, `.pick()`, and `.omit()` on `TexEngine` for clean modular schema building with full TypeScript inference.
- **Field and Schema Data Transformations**: Added `TexType.prototype.transform(fn)` for post-validation field mappings and `TexEngine.prototype.transform(fn)` for schema output reshaping.
- **Explicit Coercion Primitives (`tex.coerce.*`)**: Added `tex.coerce.number()`, `tex.coerce.boolean()`, `tex.coerce.date()`, and `tex.coerce.string()`.
- **Universal Multi-Validator OpenAPI 3.1 Duck Typing**: `schemaToOpenApi()` seamlessly translates `TexEngine`, `TexType`, and external schema libraries like **Zod** (`ZodString`, `ZodNumber`, `ZodBoolean`, `ZodDate`, `ZodEnum`, `ZodLiteral`, `ZodArray`, `ZodOptional`, `ZodNullable`, `ZodUnion`, `ZodDiscriminatedUnion`, `ZodRecord`, `ZodEffects`, `ZodObject`), raw JSON Schema, and plain property maps with zero boilerplate.
- **Field Documentation Metadata**: Added `.describe(description)` and `.example(value)` fluent methods on `TexType`.
- **`@RawBody()` Controller Parameter & `req.buffer()`**: Added `@RawBody()` decorator for OOP controllers and `req.buffer()` on `ExisRequest` for high-throughput webhook payload streaming and verification.
- **Dependency Injection Custom Providers & Contextual `inject()`**: First-class support for `useValue`, `useFactory` (with `inject` token dependencies), `useExisting` aliases, and `useClass` across `app.provide()`, `@Module()`, and `defineModule()`.

### Fixed
- **Controller Pipe Evaluation Precedence**: Fixed pipe resolution order in `controller-registrar.ts` so schema validation (`.parse()`) executes properly when passed to `@Body()`, `@Query()`, `@Param()`.
- **Automatic Query/Param String Coercion**: Ensured string query/path parameters auto-coerce to primitives when schemas are attached as parameter pipes.
- **TypeScript TS2300 Duplicate Identifier Fix**: Renamed internal example storage property in `TexType` to avoid collision with the fluent builder method `example()`.

---

## Previous Release: [0.7.12] - 2026-10-02

> For full technical details and code examples, see [**`changelog/v0.7/v0.7.12.md`**](./changelog/v0.7/v0.7.12.md).

### Added
- **Automatic Database Boot Connection (`DatabaseManager.connectAll`)**: Registered databases (`registerDatabase`) are now automatically connected during startup across `app.create()`, `defineApp().boot()`, `start-server` (before listening), and `createTestApp` with internal connection state deduplication (`_connected`).
- **Dual Callback Support for Database Health Checks (`isHealthy` & `healthCheck`)**: `DatabaseRegistration` and `DatabaseManager.checkHealth()` now support both `isHealthy` and `healthCheck` callback properties interchangeably.
- **`exisjs routes` CLI Subprocess Module Resolution**: Dynamic route introspection now executes through a TypeScript-aware subprocess with `tsx` runner and path alias loader, resolving `file:///...` module import issues on Windows and TypeScript projects.
- **New `exis run` (alias `exis exec`) CLI Command**: Automatically loads `.env`, `.env.local`, and mode files before running any TypeScript script or external tool (e.g. `exis run drizzle-kit push`, `exis run scripts/seed.ts`).
- **Production Manifest Dedicated `src/cron/` Bundling**: `generateManifest` in `manifest.ts` now prioritizes the compiled `outDir` directory in production builds, eliminating duplicate source file references and resolving `BUILD_VALIDATION_FAILED` errors on projects with dedicated `src/cron/*` tasks.
- **Standardized Cron Job Mounting Logs**: Replaced verbose multiline cron mounting logs with clean, single-line structured outputs including job name, schedule expression, and relative file path (`Mounted cron "<jobName>" (<schedule>) -> <relFile>`).
- **Starter Scaffolding `tsconfig.json` Expansion**: Expanded `tsconfigTemplate` in `create-exisjs` to include `"types": ["node"]` and include root `'*.config.ts'`, `'*.config.js'`, and `'*.ts'` patterns, preventing `TS2580: Cannot find name 'process'` in standalone tools like `drizzle.config.ts`.
- **Documentation & Type Synchronization**: Corrected `docs/reference/database.mdx` with exact signatures for `registerDatabase` and return types for `DatabaseManager.checkHealth()`.
- **Scaffolding Dependency Updates**: Starter templates in `create-exisjs` now target `exisjs: '^0.7.12'`.

---

## Previous Release: [0.7.11] - 2026-10-01

> For full technical details and code examples, see [**`changelog/v0.7/v0.7.11.md`**](./changelog/v0.7/v0.7.11.md).

### Added
- **Static Route In-Memory Fast Path**: `NativeRadixTree` builds an exact static lookup map (`staticCache`) for parameterless routes, bypassing tree traversal and pushing server throughput over 51,000 req/sec.
- **Zero-Allocation `AbortSignal` Lazy Instantiation**: `ExisRequest.prototype.signal` is now created only when accessed, reducing garbage collection overhead and event listeners on standard requests.
- **High-Performance uWS Adapter Parity**: Full EventEmitter and lifecycle method parity on `UwsIncomingMessage`, `UwsServerResponse`, and `UwsWebSocketShim` (`.once()`, `.off()`, `.removeListener()`, `.removeAllListeners()`, `.destroyed`, `.writableEnded`, `.writeHead()`, `.getHeaders()`, `.getHeaderNames()`, `.flushHeaders()`).
- **Timing-Safe String / Buffer Comparison (`timingSafeEqual`)**: Constant-time comparison in `exisjs/middleware` for API keys, tokens, and HMAC signatures with dummy comparisons preventing length-leak timing attacks.
- **Configurable Dev Server Watcher**: Added `dev` options to `defineConfig` (`watch`, `ignored`, `usePolling`, `interval`, `binaryInterval`) for container, VM, and Windows file-watching workflows.
- **Flexible Database Lifecycle Registration**: `registerDatabase` supports both `(options)` and `(app, options)` signatures.
- **CLI Scaffolding Alignments (`create-exisjs`)**: Updated template generator for `src/cron/cleanup.ts` with `cron()` and `@Cron()` and bumped dependencies to `^0.7.11`.

---

## Previous Release: [0.7.10] - 2026-09-27

> For full technical details and code examples, see [**`changelog/v0.7/v0.7.10.md`**](./changelog/v0.7/v0.7.10.md).

### Added
- **Class Controller Inheritance (Base & Abstract Controller Support)**: Route discovery, parameters, middlewares, guards, interceptors, and filters across full prototype chains.
- **Property-Level `@Inject()` & `@Optional()` Decorators**: Direct field injection with TypeScript `design:type` reflection fallback.
- **Forward References & Circular Dependency DI Resolution (`forwardRef`)**: Lazy ES6 proxy-based cyclic resolution for singleton providers.
- **Built-in Parameter Transformation Pipes & `@UsePipes`**: `ParseIntPipe`, `ParseFloatPipe`, `ParseBoolPipe`, `ParseUUIDPipe`, `ParseArrayPipe`, `ValidationPipe`, and `@UsePipes()`.
- **`@Global()` Module Decorator**: Global provider and module exports without re-importing across modules.
- **Automatic Constructor Parameter Type Reflection (`design:paramtypes`)**: In OOP controllers and services, ExisJS inspects `design:paramtypes` and auto-resolves constructor classes directly from `INJECTABLE_REGISTRY` without requiring boilerplate `@Inject()`.
- **Built-in Safe Response Serializer (`safeSanitize`)**: Zero-crash JSON response serialization in the HTTP response pipeline. Automatically unwraps Mongoose documents (`.toObject({ virtuals: true, getters: true })`), BSON types (`ObjectId`, `Decimal128`, `Long`, `Binary`), `BigInt` (to string), `Date` (to ISO 8601), and `Map`/`Set`.
- **Enhanced Serialization Diagnostics**: Detailed property path tracking (e.g. `'recentTransactions[0].accountId'`) for clear debugging of un-serializable properties.
- **Automatic Query Parameter Type Coercion**: Query schemas with `tex.number()` and `tex.boolean()` automatically coerce numeric and boolean query strings (`"100"` $\to$ `100`, `"true"` $\to$ `true`).
- **Standardized Error Response Envelope**: Standardized framework error responses into a consistent JSON envelope (`success: false`, `statusCode`, `error`, `message`, `validationErrors`, `errors`, `timestamp`).
- **Reverse Proxy & Multi-CDN IP Resolution**: Evaluates `CF-Connecting-IP`, `True-Client-IP`, `X-Real-IP`, and `X-Client-IP` before `X-Forwarded-For` when `trustProxy: true` (or `process.env.TRUST_PROXY === 'true'`).
- **Smart ETag Disabling**: Set `etag: false` by default for dynamic API routes to eliminate redundant SHA-1 computation overhead and clarify dev response log timings.
- **Test Harness Options**: Enhanced `createTestApp` client HTTP methods to accept optional request options (such as custom request headers).

---

## Previous Release: [0.7.9] - 2026-09-24

> For full technical details and code examples, see [**`changelog/v0.7/v0.7.9.md`**](./changelog/v0.7/v0.7.9.md).

### Added
- **Enterprise OOP Architecture Decorators**:
  - Security & Authorization: `@Permissions()`, `@Roles()`, `@Public()` (`@IsPublic()`, `@AllowAnonymous()`) with automatic `isSuperAdmin` bypass.
  - Service Lifecycle Hooks: `OnInit`, `OnDestroy`, `OnModuleInit`, `OnModuleDestroy`, `OnApplicationBootstrap`.
  - Native Off-Heap Method Caching: `@Cacheable()` and `@CacheEvict()` powered by Rust `NativeMemoryCache`.
  - Automated Transactions: `@Transactional()` supporting ExisJS DB, Prisma, Drizzle, TypeORM, Knex, and connection pools.
  - Sub-Millisecond Profiling: `@Profile()` decorator with SLA threshold warnings.
  - Declarative Exception Filtering: `@Catch(...exceptions)` and `@UseFilters()` with `ExceptionFilter` and `ArgumentsHost`.
  - Dual Class/Type Exception Declarations: Subclassed `NotFoundException`, `UnauthorizedException`, `ForbiddenException`, `BadRequestException`, `ConflictException`, `PayloadTooLargeException`, `UnprocessableException`, `RateLimitException`, `InternalException`.

### Fixed
- **Route Method Schema Normalization**: Fixed `TS(2559)` by automatically normalizing raw `TexEngine`/Zod schemas and wrapped `{ body, query, params, headers }` objects in `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, etc.
- **Async Generator Type Safety**: Added explicit `Promise<T>` return types across all starter templates to prevent `TS(1064)`.
- **Test Harness Types & Boot Memoization**: Enabled `createTestApp` and `createTestContext` to seamlessly accept `ExisConfig` and `ExisAppDefinition` without `TS(2345)`.
- **Dev Watcher Lockfile Loop**: Enhanced `chokidar` in `exis dev` to ignore lockfiles, dotfiles, and build caches, eliminating restart loops during `npm install`.
- **ESM Multiline Import Path Resolution**: Fixed regex in `resolve-aliases.ts` to correctly append `.js` extensions on multiline import and export statements during `exis build`.
- **Scaffolding Template Alignment**: Standardized `exis.config.ts` generator template to export `const config: ExisConfig` and `export default config`.



