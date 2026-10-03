# ExisJS

[![npm exisjs package](https://img.shields.io/npm/v/exisjs.svg)](https://npmjs.org/package/exisjs)
[![npm license](https://img.shields.io/npm/l/exisjs.svg)](https://github.com/v25group/exisjs/blob/main/LICENSE)
[![GitHub discussions](https://img.shields.io/badge/Discussions-GitHub-blue.svg)](https://github.com/v25group/exisjs/discussions)

ExisJS is a TypeScript framework for Node.js backends. It integrates file-system routing, runtime schema validation, dependency injection, and automatic OpenAPI schema generation with a native Rust core (`@exisjs/rs`).

---

## Key Capabilities

- **File-System Routing**: Automatic route discovery from `src/http/*` directory structure with support for functional routes and class-based controllers.
- **Native Engine Core**: Native routing radix tree, rate limiting, and parameter validation backed by `@exisjs/rs` with automatic TypeScript fallbacks.
- **Integrated Validation**: Typed validation schemas using `tex.*` with automatic type inference and parameter coercion.
- **Dependency Injection**: IoC container supporting constructor injection, field decorators (`@Inject()`), contextual injection (`inject()`), and custom providers (`useValue`, `useFactory`, `useExisting`, `useClass`).
- **Automatic OpenAPI Documentation**: Swagger/OpenAPI 3.1 schema and interactive documentation automatically compiled from route definitions.
- **End-to-End Type Safety**: Companion `@exisjs/fetch` client provides typed route auto-completion and response inference.

---

## Requirements

- [Node.js](https://nodejs.org/) v20.19 or newer LTS
- [npm](https://www.npmjs.com/) v9 or newer

---

## Quickstart

Scaffold a new ExisJS project with the official CLI:

```bash
npm create exisjs@latest my-backend
cd my-backend
npm run dev
```

Or install `exisjs` into an existing Node.js project:

```bash
npm install exisjs
```

---

## Routing Paradigms

ExisJS supports two programming paradigms with feature parity.

### 1. Functional Routing

Define functional route handlers with `controller` and `route`:

```typescript
import { controller, route } from 'exisjs/router'
import { tex } from 'exisjs/validator'

const UserSchema = tex.object({
  id: tex.number(),
  name: tex.string(),
})

export default controller({
  createUser: route.post('/', {
    body: UserSchema,
    returns: UserSchema,
    handle: async ({ body }) => {
      return { id: Date.now(), name: body.name }
    },
  }),
})
```

### 2. Class-Based Controllers (OOP)

Define class-based controllers using decorators:

```typescript
import { Controller, Post, Body, Returns } from 'exisjs/decorators'
import { tex } from 'exisjs/validator'

const UserSchema = tex.object({
  id: tex.number(),
  name: tex.string(),
})

@Controller()
export default class UserController {
  @Post('/')
  @Returns(UserSchema)
  async createUser(@Body() body: typeof UserSchema) {
    return { id: Date.now(), name: body.name }
  }
}
```

---

## Project Structure

A standard ExisJS application uses the following directory layout:

```text
my-api/
├── .agents/
│   └── rules/
│       └── AGENTS.md            # LLM architectural rules and coding standards
├── .exis/                       # Framework cache and compiled route manifests (git-ignored)
├── src/
│   ├── http/                    # File-system routing and HTTP request pipeline (auto-discovered)
│   │   ├── server.ts            # Server lifecycle hooks (onStart, onClose)
│   │   ├── boundary.ts          # Root boundary (CORS, security headers, global error handling)
│   │   ├── route.ts             # Root route handler (GET /)
│   │   ├── error.ts             # Global exception and validation error handler (onError)
│   │   ├── health/
│   │   │   └── route.ts         # GET /health endpoint
│   │   ├── users/
│   │   │   ├── route.ts         # Route endpoints for /users
│   │   │   ├── schema.ts        # Input validation schemas (tex.*)
│   │   │   └── service.ts       # Feature business logic and data access
│   │   └── admin/
│   │       ├── boundary.ts      # Scoped boundary applying to /admin and nested routes
│   │       └── posts/
│   │           ├── route.ts     # Route endpoints for /admin/posts
│   │           ├── schema.ts    # Validation schemas for /admin/posts
│   │           └── service.ts   # Service logic for /admin/posts
│   ├── cron/                    # Scheduled background tasks (auto-discovered)
│   │   └── cleanup.ts           # Cron task definitions
│   ├── database/                # Persistent storage configuration and lifecycle
│   │   ├── db.ts                # Database connection client and lifecycle registration
│   │   └── models/              # Database models, schemas, and entity definitions
│   ├── common/                  # Shared cross-cutting components
│   │   └── guards/
│   │       └── auth.guard.ts    # Reusable route guards
│   └── config/
│       └── env.ts               # Environment variable validation schema (tex.env)
├── tests/                       # Automated test suites (*.test.ts, *.e2e-spec.ts)
├── .env                         # Local environment variables
├── .gitignore
├── .prettierrc
├── eslint.config.mjs            # ESLint flat configuration (optional)
├── exis.config.ts               # Application configuration file
├── package.json
└── tsconfig.json
```

---

## Packages in This Monorepo

| Package | Purpose |
| :--- | :--- |
| [`exisjs`](./packages/exisjs) | Core framework, HTTP pipeline, router, DI container, and Swagger documentation |
| [`@exisjs/fetch`](./packages/fetch) | Lightweight type-safe HTTP client for frontend and microservice consumption |
| [`create-exisjs`](./packages/create) | CLI generator for scaffolding starter projects |
| [`@exisjs/rs`](./packages/rs) | Native Rust engine for radix routing, cache, and validation |

---

## Example Applications

- [**01-my-app**](./examples/01-my-app): Minimal starter project demonstrating file-system routing and configuration.
- [**02-bookstore**](./examples/02-bookstore): REST API demonstrating nested routes, error boundaries, and dependency injection.
- [**03-all-features**](./examples/03-all-features): Comprehensive application demonstrating functional and class-based patterns, validation, and middleware.

---

## Documentation

Full guides, API references, and architecture explanations are available in the [documentation directory](./docs) and online at [exisjs.com](https://exisjs.com).

- [Getting Started Guide](./docs/content/getting-started.mdx)
- [Routing Documentation](./docs/content/routing.mdx)
- [Dependency Injection](./docs/content/providers.mdx)
- [Validation Engine](./docs/content/validation.mdx)

---

## Contributing

Please review the [Contribution Guidelines](./CONTRIBUTING.md) before submitting pull requests.

---

## License

ExisJS is licensed under the [MIT License](./LICENSE).
