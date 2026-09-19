# Changelog

All notable changes to the ExisJS framework monorepo are documented here and in modular release files under [`changelog/`](./changelog/).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Release Directory & Navigation

| Version | Release Date | Type | Key Highlights | Detailed Notes |
| :--- | :--- | :--- | :--- | :--- |
| **`v0.7.5`** | 2026-09-19 | Resilience & DX | Error convention, boundary hooks, AbortSignal, CHIPS, instant shutdown | [**Read v0.7.5 Notes →**](./changelog/v0.7/v0.7.5.md) |
| **`v0.7.4`** | 2026-09-11 | Features & Validations | Diagnostic table, declarative uploads, route timeouts, nested arrays | [**Read v0.7.4 Notes →**](./changelog/v0.7/v0.7.4.md) |
| **`v0.7.3`** | 2026-09-09 | Features & Rust Perf | Native Rust Brotli/Gzip, realtime SSE streaming, `exis routes` & `doctor` CLI | [**Read v0.7.3 Notes →**](./changelog/v0.7/v0.7.3.md) |
| **`v0.7.2`** | 2026-09-06 | Bug Fixes & DX | TypeScript route param inference, runtime aliases, ESM relative fixes | [**Read v0.7.2 Notes →**](./changelog/v0.7/v0.7.2.md) |
| **`v0.7.1`** | 2026-09-06 | OOP & Logging | Full OOP parity decorators, DI scopes, `@Use(...)` unification, Pino logger | [**Read v0.7.1 Notes →**](./changelog/v0.7/v0.7.1.md) |
| **`v0.7.0`** | 2026-09-06 | Major Architecture | Monorepo decoupling, `boundary.ts` pipeline, native Rust `tex` validator | [**Read v0.7.0 Notes →**](./changelog/v0.7/v0.7.0.md) |

---

## Current Release: [0.7.5] - 2026-09-19

> For full technical details and code examples, see [**`changelog/v0.7/v0.7.5.md`**](./changelog/v0.7/v0.7.5.md).

### Added
- **Centralized Exception Handler (`src/http/error.ts`)**: Auto-discovered by the framework without manual registration in `server.ts`. New scaffolding command `exis g error`.
- **Boundary Lifecycle Hooks**: Granular `beforeHandle(req, res)` (route guarding) and `afterHandle(req, res, data)` (payload transformation / auditing) across functional and OOP paradigms.
- **Request Cancellation & Modern Network Standards**:
  - `req.signal`: Standard Web API `AbortSignal` triggered when the client disconnects or aborts the request.
  - `req.ip` IPv6 Normalization: Automatically strips dual-stack `::ffff:` IPv4-mapped prefixes and normalizes `::1` to `127.0.0.1`.
- **Modern Cookie Specifications**:
  - Added Partitioned cookies (`CHIPS`) via `partitioned: true` for third-party iframe contexts.
  - Added storage retention hints via `priority: 'low' | 'medium' | 'high'`.
  - Automatically enforces `secure: true` whenever `sameSite: 'None'` is declared per RFC 6265bis.
  - Scoped cookie deletion via `res.clearCookie(name, { path, domain })`.
- **Safe Stream Resource Management (`res.sendStream`)**: Automatically destroys readable streams on client disconnect to eliminate socket and file descriptor leaks.
- **Schema & Query String Coercion**:
  - `tex.date({ coerce: true, minDate, maxDate })`: Parses ISO 8601 strings and UNIX timestamps into native JavaScript `Date` instances.
  - `tex.array(schema, { coerce: true })`: Automatically coerces single strings and comma-separated query parameters (e.g. `?tags=node,rust`) into typed arrays.
- **Rate-Limiting Standards**: Standard IETF draft headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`) and RFC 6585 `Retry-After` on HTTP 429.
- **Server Graceful Teardown**: Instant termination of idle keep-alive sockets via `server.closeIdleConnections()`, cutting reload delay to < 10ms.
- **CI/CD Build Resilience**: Added `--skip-env-check` and mock schema resolution for headless container production builds.

### Fixed
- **Sanitizer & Validator Null Handling**: Prevented `TypeError: Cannot read properties of null (reading 'trim')` on nullable schemas and inner array items in both TypeScript and Rust engines.
- **Dev Watcher Windows File Lock Crash**: Intercepted non-fatal `EBUSY`, `EPERM`, and `UNKNOWN` file lock exceptions on Chokidar watchers on Windows; expanded ignore rules for archives and temporary files.
- **Root Tool Configuration Isolation**: Scoped `exis build` strictly to application source files, avoiding erroneous compilation of root tool configs like `drizzle.config.ts` or `vite.config.ts`.
