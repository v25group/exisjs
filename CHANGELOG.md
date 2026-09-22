# Changelog

All notable changes to the ExisJS framework monorepo are documented here and in modular release files under [`changelog/`](./changelog/).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Release Directory & Navigation

| Version | Release Date | Type | Key Highlights | Detailed Notes |
| :--- | :--- | :--- | :--- | :--- |
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

## Current Release: [0.7.8] - 2026-09-22

> For full technical details and code examples, see [**`changelog/v0.7/v0.7.8.md`**](./changelog/v0.7/v0.7.8.md).

### Added
- **Subpath Export (`exisjs/swagger`)**: Registered `./swagger` subpath export in `packages/exisjs/package.json` for dedicated module resolution of `swagger`, `docs`, `generateOpenApiSpec`, `renderDocumentationHtml`, and all OpenAPI decorators.

### Fixed
- **Documentation Parity**: Corrected file path annotations and controller export syntaxes across `docs/content/swagger.mdx` and `docs/reference/swagger.mdx` to reflect standard ExisJS folder routing (`route.ts`).
- **Template Dependency Update**: Bumped template generator dependency in `create-exisjs` to `exisjs: '^0.7.8'`.


