# ExisJS Documentation Content Directory

This directory contains the user guides, conceptual explanations, and how-to manuals for ExisJS.

Documentation follows the [Diátaxis Framework](https://diataxis.fr/), separating conceptual overviews, procedural how-to guides, and reference materials.

---

## Content Index

### 1. Getting Started & Architecture
- [`introduction.mdx`](./introduction.mdx): Overview of framework architecture, design decisions, and supported paradigms.
- [`installation.mdx`](./installation.mdx): Prerequisites, project scaffolding (`npm create exisjs@latest`), and manual setup.
- [`structure.mdx`](./structure.mdx): Standardized directory layout (`src/http/`, `src/database/`, `src/common/`, `src/config/`, `src/cron/`).

### 2. HTTP Routing & Request Pipeline
- [`routing.mdx`](./routing.mdx): File-system routing conventions (`route.ts`), path parameters, route groups, and handlers.
- [`controllers.mdx`](./controllers.mdx): Class-based routing, `@Controller` decorators, and parameter mappings.
- [`decorators.mdx`](./decorators.mdx): Reference guide for all decorators across routing, parameters, pipes, middlewares, security, and lifecycle.
- [`requests.mdx`](./requests.mdx): Request anatomy (`ExisRequest`), query strings, headers, cookies, and context augmentation.
- [`responses.mdx`](./responses.mdx): Response helpers, JSON output, HTTP status codes, SSE, and stream handling.
- [`boundaries.mdx`](./boundaries.mdx): Directory-scoped middleware cascading, hierarchical CORS inheritance, and boundary isolation.

### 3. Validation, Dependency Injection & Data
- [`validation.mdx`](./validation.mdx): Schema validation engine (`tex.*`), parameter coercion, custom validators, and sanitization.
- [`providers.mdx`](./providers.mdx): Dependency injection, constructor injection, `@Injectable()`, `@Inject()`, and `forwardRef()`.
- [`modules.mdx`](./modules.mdx): Module encapsulation, `@Module()`, dynamic module registration, and `@Global()` scopes.

### 4. Middleware, Security & Operations
- [`middleware.mdx`](./middleware.mdx): Global, boundary, and route-level middlewares, Express bridge, and execution order.
- [`security.mdx`](./security.mdx): Security headers (Helmet), CSRF tokens, CIDR IP filtering, parameter pollution, and probe blocking.
- [`errors.mdx`](./errors.mdx): HTTP exception classes, JSON error payloads, and custom error boundaries.
- [`cron.mdx`](./cron.mdx): Background task scheduling (`cron()` and `@Cron()`) with drift correction and overlap protection.
- [`swagger.mdx`](./swagger.mdx): Automatic OpenAPI 3.1 schema extraction, Swagger UI (`/docs`), and JSON documentation endpoints.
- [`testing.mdx`](./testing.mdx): Test harness (`createTestContext`, `createTestApp`), mocking utilities (`ex`), and CLI test runner.
- [`config.mdx`](./config.mdx): Global configuration options in `exis.config.ts`, lifecycle phases, clustering, and file watcher settings.
- [`exisjs-mcp.mdx`](./exisjs-mcp.mdx): Model Context Protocol (MCP) server integration for IDE AI assistants.

### 5. CLI Tooling (`cli/`)
- [`cli/overview.mdx`](./cli/overview.mdx): CLI architecture and runtime execution.
- [`cli/usage.mdx`](./cli/usage.mdx): Basic usage and script execution.
- [`cli/commands.mdx`](./cli/commands.mdx): Reference for all CLI commands (`dev`, `build`, `start`, `routes`, `test`, `doctor`, `init`).

