# Changelog

All notable changes to the ExisJS framework monorepo are documented here and in modular release files under [`changelog/`](./changelog/).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Release Directory & Navigation

| Version | Release Date | Type | Key Highlights | Detailed Notes |
| :--- | :--- | :--- | :--- | :--- |
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

## Current Release: [0.7.9] - 2026-09-24

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



