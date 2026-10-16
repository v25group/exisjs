# ExisJS API Reference Catalog

This directory contains complete, information-dense API references, TypeScript interfaces, and method signatures for all public packages and subpath exports in the ExisJS framework.

---

## Reference Index

| Module / Entrypoint | Document                                                                               | Description                                                                                            |
| :------------------ | :------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| `exisjs`            | [`exis.mdx`](./exis.mdx)             | Root application builder (`exis` / `defineApp`), `App` instance methods, and process resolvers.        |
| `exisjs/config`     | [`config.mdx`](./config.mdx)         | Configuration schema (`ExisConfig`, `WatchConfig`, `DevConfig`), environment parsing, and phases.      |
| `exisjs/router`     | [`router.mdx`](./router.mdx)         | Functional route builder (`route.*`, `controller`), `Router` engine, and request/response types.       |
| `exisjs/decorators` | [`decorators.mdx`](./decorators.mdx) | Class, method, and parameter decorators for OOP architecture (`@Controller`, `@Get`, `@Body`).         |
| `exisjs/validator`  | [`validator.mdx`](./validator.mdx)   | `TexEngine` validator suite (`tex.*`), schema modifiers (`.optional()`, `.default()`), and pipes.      |
| `exisjs/database`   | [`database.mdx`](./database.mdx)     | Database lifecycle coordinator (`registerDatabase`, `DatabaseManager`), and transactions.              |
| `exisjs/logger`     | [`logger.mdx`](./logger.mdx)         | Structured Pino logger interface, log levels, sensitive credential redaction, and formatters.          |
| `exisjs/di`         | [`di.mdx`](./di.mdx)                 | Inversion of Control `Container`, dependency injection tokens, `inject()`, and `forwardRef()`.         |
| `exisjs/error`      | [`error.mdx`](./error.mdx)           | HTTP exception hierarchy (`HttpError`, `BadRequestException`), error codes, and JSON envelopes.        |
| `exisjs/middleware` | [`middleware.mdx`](./middleware.mdx) | Built-in middleware suite: Helmet, CORS, CSRF, rate limiting, IP filtering, and multipart uploads.     |
| `exisjs/context`    | [`context.mdx`](./context.mdx)       | `AsyncLocalStorage` request context API (`getRequest`, `getResponse`, `getContext`, `after`).          |
| `exisjs/cron`       | [`cron.mdx`](./cron.mdx)             | Task scheduler (`cron()`, `@Cron()`), interval timers, presets, and `CronManager` runtime controls.    |
| `exisjs/sanitize`   | [`sanitize.mdx`](./sanitize.mdx)     | Security cleaners (`escapeHtml`, `preventSql`) and data transform utilities.          |
| `exisjs/swagger`    | [`swagger.mdx`](./swagger.mdx)       | OpenAPI 3.1 specification generation, Swagger UI / Scalar interactive rendering, and decorators.       |
| `exisjs/testing`    | [`testing.mdx`](./testing.mdx)       | Test runner (`node:test`), synthetic HTTP client (`createTestApp`), `expect` matchers, and `ex` mocks. |
| `exisjs/plugin`     | [`plugin.mdx`](./plugin.mdx)         | Modular plugin development (`definePlugin`), lifecycle hooks, and dependency encapsulation.            |

---

## Diátaxis Alignment

The reference documents in this directory are structured strictly for **lookup and precision** according to the Diátaxis framework:

- **Information-Dense**: Method signatures, return types, and default option tables.
- **Accurate & Tested**: 100% verified against monorepo source files under `packages/exisjs/src/*`.
