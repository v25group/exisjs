# exisjs

[![npm exisjs package](https://img.shields.io/npm/v/exisjs.svg)](https://npmjs.org/package/exisjs)
[![npm license](https://img.shields.io/npm/l/exisjs.svg)](https://github.com/v25group/exisjs/blob/main/LICENSE)
[![GitHub discussions](https://img.shields.io/badge/Discussions-GitHub-blue.svg)](https://github.com/v25group/exisjs/discussions)

`exisjs` is the core package for the ExisJS web framework. It provides the HTTP execution engine, file-system routing, dependency injection container, native validation schemas (`tex`), security middlewares, and OpenTelemetry instrumentation.

---

## Installation

Install `exisjs` via npm:

```bash
npm install exisjs
```

Or initialize a new project using the scaffolding CLI:

```bash
npm create exisjs@latest my-backend
```

---

## Core Features

- **File-System Routing**: Automatic route discovery from `src/http/*` endpoints without manual router registration.
- **Dual Paradigm**: Full feature parity between functional routes (`controller`, `route.*`) and class-based controllers (`@Controller`, `@Get`, `@Post`, etc.).
- **Dependency Injection**: Contextual IoC container with support for constructor injection, `@Inject()`, contextual `inject()`, and custom providers (`useValue`, `useFactory`, `useExisting`, `useClass`).
- **Validation Engine**: Fast type-safe schema validation and parameter coercion using `tex.*`.
- **Folder Boundaries & Middleware**: Cascading security headers (`helmet`), CORS, CSRF, CIDR IP filtering, rate limiting, and idempotency caching.
- **Auto-Generated OpenAPI Docs**: Interactive Swagger documentation generated directly from route definitions at `/docs`.

---

## Application Structure & Usage

ExisJS applications use file-system routing and configuration files driven by `exisjs` CLI commands (`exisjs dev`, `exisjs build`, `exisjs start`).

### 1. Application Configuration (`exis.config.ts`)

```typescript
import type { ExisConfig } from 'exisjs/config'

const config: ExisConfig = {
  port: Number(process.env.PORT) || 4000,
  host: '0.0.0.0',

  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  },

  logger: {
    level: 'debug',
    pretty: process.env.NODE_ENV !== 'production',
  },

  helmet: { enabled: true },
  asyncContext: true,
  compression: true,
}

export default config
```

### 2. Route Handlers (`src/http/route.ts`)

ExisJS supports both functional and class-based (OOP) paradigms with 100% feature parity.

#### Option A: Functional Routing

```typescript
import { controller, route } from 'exisjs/router'
import { tex } from 'exisjs/validator'

const UserSchema = tex.object({
  id: tex.number(),
  name: tex.string(),
})

export default controller({
  welcome: route.get('/', {
    summary: 'Root Welcome Endpoint',
    handle() {
      return { message: 'Welcome to ExisJS!' }
    },
  }),
  createUser: route.post('/users', {
    summary: 'Create User',
    body: UserSchema,
    returns: UserSchema,
    handle: async ({ body }) => {
      return { id: Date.now(), name: body.name }
    },
  }),
})
```

#### Option B: Class-Based Controllers (OOP)

```typescript
import { Controller, Get, Post, Body, Param, Query } from 'exisjs/decorators'
import { tex } from 'exisjs/validator'

const CreateUserSchema = tex.object({
  name: tex.string(),
})

@Controller()
export default class UserController {
  @Get('/')
  welcome() {
    return { message: 'Welcome to ExisJS!' }
  }

  @Post('/users')
  async createUser(@Body(CreateUserSchema) body: { name: string }) {
    return { id: Date.now(), name: body.name }
  }

  @Get('/users/:id')
  async getUser(@Param('id') id: string) {
    return { id, name: 'Sample User' }
  }
}
```

### 3. Server Lifecycle (`src/http/server.ts`)

#### Option A: Functional (`exis`)

```typescript
import { exis } from 'exisjs'

export default exis({
  async onStart(app) {
    app.provide('DATABASE_URL', { useValue: process.env.DATABASE_URL })
    console.log('Application server started')
  },
  async onClose(app) {
    console.log('Application gracefully shutting down')
  },
})
```

#### Option B: Class-Based OOP (`@Server`)

```typescript
import { Server } from 'exisjs/decorators'
import type { App } from 'exisjs'

@Server()
export default class RootServer {
  async onStart(app: App) {
    app.provide('DATABASE_URL', { useValue: process.env.DATABASE_URL })
    app.log.info('Application server started')
  }

  async onClose(app: App) {
    app.log.info('Application gracefully shutting down')
  }
}
```

### 4. Running the Application

Add the framework scripts to your `package.json`:

```json
{
  "scripts": {
    "dev": "exisjs dev",
    "build": "exisjs build",
    "start": "exisjs start",
    "test": "exisjs test"
  }
}
```

Start the development server with live reload:

```bash
npm run dev
```

---

## Subpath Exports

`exisjs` exposes scoped subpath exports for clean imports:

| Export | Description | Key APIs |
| :--- | :--- | :--- |
| `exisjs` | Core framework, server define, and response helpers | `exis`, `defineConfig`, `json`, `error`, `HttpStatus` |
| `exisjs/router` | Functional routing, controllers, boundaries, and contextual inject | `controller`, `route`, `defineBoundary`, `inject` |
| `exisjs/decorators` | OOP routing, DI, lifecycle, and parameter decorators | `@Controller`, `@Get`, `@Post`, `@Injectable`, `@Inject` |
| `exisjs/validator` | Type-safe schema builder and parameter validator | `tex.object`, `tex.string`, `tex.number`, `tex.env` |
| `exisjs/middleware` | Security and traffic control middlewares | `helmet`, `cors`, `csrf`, `rateLimit`, `ipFilter` |
| `exisjs/config` | Configuration builders and phase constants | `defineConfig`, `PHASE_DEVELOPMENT_SERVER` |
| `exisjs/di` | Inversion of control container and provider tokens | `Container`, `createToken`, `CustomProvider` |
| `exisjs/cron` | Scheduled background task definitions | `cron`, `@Cron` |
| `exisjs/testing` | E2E and unit test harnesses | `createTestApp`, `createTestContext` |

---

## Documentation

Full documentation, architecture explanations, and tutorials are available at [exisjs.com](https://exisjs.com) and in the root [docs directory](../../docs).

---

## License

[MIT License](https://github.com/v25group/exisjs/blob/main/LICENSE)
