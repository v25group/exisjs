export function packageJsonTemplate(
  name: string,
  useEslint: boolean,
  useTypeScript: boolean
): string {
  const scripts: Record<string, string> = {
    dev: 'exisjs dev',
    build: 'exisjs build',
    start: 'exisjs start',
    test: 'exisjs test',
    format: 'prettier --write "src/**/*.ts"',
  }

  if (useEslint) {
    scripts.lint = 'eslint .'
    scripts['lint:fix'] = 'eslint . --fix'
  }

  const pkg: {
    name: string
    version: string
    private: boolean
    scripts: Record<string, string>
    dependencies: Record<string, string>
    type?: string
    devDependencies?: Record<string, string>
  } = {
    name,
    version: '0.1.0',
    private: true,
    type: 'module',

    scripts,
    dependencies: {
      exisjs: '^0.7.5',
    },
  }

  if (useTypeScript) {
    pkg.devDependencies = {
      '@types/node': '^20.0.0',
      prettier: '^3.3.3',
      typescript: '^5.5.0',
    }
  } else {
    pkg.devDependencies = {
      prettier: '^3.3.3',
    }
  }

  if (useEslint) {
    pkg.devDependencies = {
      ...(pkg.devDependencies || {}),
      eslint: '^10.0.0',
      '@eslint/js': '^10.0.0',
      'eslint-config-prettier': '^10.0.0',
    }
    if (useTypeScript) {
      pkg.devDependencies['typescript-eslint'] = '^8.0.0'
    }
  }

  return JSON.stringify(pkg, null, 2)
}

export function tsconfigTemplate(alias = '@/*'): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['esnext'],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        esModuleInterop: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        paths: {
          [alias]: ['./src/*'],
        },
      },
      include: ['src/**/*.ts', 'tests/**/*.ts', 'exis.config.ts'],
      exclude: ['node_modules', '.exis', 'dist', 'build'],
    },
    null,
    2
  )
}

export function exisConfigTemplate(useTypeScript: boolean): string {
  const typeHeader = useTypeScript
    ? `import { defineConfig } from 'exisjs'\n\nexport default defineConfig({`
    : `import { defineConfig } from 'exisjs'\n\nexport default defineConfig({`

  return `${typeHeader}
  port: Number(process.env.PORT) || 4000,
  host: '0.0.0.0',

  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  },

  logger: {
    level: 'info',
    pretty: process.env.NODE_ENV !== 'production',
  },

  helmet: { enabled: true },

  // Set to true if you need to use getContext() globally in production
  asyncContext: false,

  test: {
    include: ['tests/**/*.test.ts']
  }
})
`
}

export function envTsTemplate(useTypeScript: boolean): string {
  if (useTypeScript) {
    return `import { tex } from 'exisjs/validator'

export const env = tex.env({
  PORT: tex.number({ default: 4000 }),
  NODE_ENV: tex.enum(['development', 'production', 'test'] as const, {
    default: 'development',
  }),
  CORS_ORIGIN: tex.string({ default: '*' }),
}).parse(process.env)
`
  } else {
    return `import { tex } from 'exisjs/validator'

export const env = tex.env({
  PORT: tex.number({ default: 4000 }),
  NODE_ENV: tex.enum(['development', 'production', 'test'], {
    default: 'development',
  }),
  CORS_ORIGIN: tex.string({ default: '*' }),
}).parse(process.env)
`
  }
}

export function serverTemplate(
  paradigm: string,
  useTypeScript: boolean
): string {
  if (paradigm === 'oop') {
    const importType = useTypeScript
      ? `\nimport type { App } from 'exisjs'`
      : ''
    const paramType = useTypeScript ? ': App' : ''

    return `import { Server } from 'exisjs/decorators'${importType}

@Server()
export default class RootServer {
  async onStart(app${paramType}) {
    // 1. Connect to your database
    // await db.connect()
    
    // 2. Register plugins
    // app.plugin(authPlugin)
    
    // The Exis CLI automatically boots the server and file-system routes
  }
  
  async onClose(app${paramType}) {
    // Gracefully close database connections here
    // await db.disconnect()
  }
}
`
  }

  return `import { exis } from 'exisjs'

export default exis({
  async onStart(app) {
    // 1. Connect to your database
    // await db.connect()
    
    // 2. Register plugins
    // app.plugin(authPlugin)
    
    // The Exis CLI automatically boots the server and file-system routes
  },
  
  async onClose(app) {
    // Gracefully close database connections here
    // await db.disconnect()
  }
})
`
}

export function healthRouteTemplate(paradigm: string): string {
  if (paradigm === 'oop') {
    return `import { Controller, Get } from 'exisjs/decorators'

@Controller()
export default class HealthController {
  @Get('/')
  check() {
    return { 
      status: 'ok',
      timestamp: new Date().toISOString()
    }
  }
}
`
  }

  return `import { controller, route } from 'exisjs/router'

export default controller({
  check: route.get('/', {
    handle() {
      return { 
        status: 'ok',
        timestamp: new Date().toISOString()
      }
    }
  })
})
`
}

export function rootRouteTemplate(paradigm: string): string {
  if (paradigm === 'oop') {
    return `import { Controller, Get } from 'exisjs/decorators'

@Controller()
export default class RootController {
  @Get('/')
  welcome() {
    return { message: 'Welcome to Exis JS!' }
  }
}
`
  }

  return `import { controller, route } from 'exisjs/router'

export default controller({
  welcome: route.get('/', {
    handle() {
      return { message: 'Welcome to Exis JS!' }
    }
  })
})
`
}

export function envTemplate(): string {
  return `PORT=4000
NODE_ENV=development
CORS_ORIGIN=*
`
}

export function gitignoreTemplate(): string {
  return `# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.

# Exis JS Cache & Artifacts
.exis/
dist/
build/

# Dependencies
node_modules/
.pnp
.pnp.*
.yarn/*
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/versions

# Environment Variables & Secrets
.env
.env.*
!.env.example

# Testing & Coverage
coverage/
.nyc_output/

# OS Artifacts
.DS_Store
Thumbs.db
*.pem

# Debug Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
.pnpm-debug.log*

# TypeScript
*.tsbuildinfo
`
}

export function readmeTemplate(name: string): string {
  return `# ${name}

This is an [Exis JS](https://github.com/v25group/exisjs) project bootstrapped with \`create-exis\`.

## Getting Started

First, run the development server:

\`\`\`bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
\`\`\`

Open [http://localhost:4000](http://localhost:4000) with your API client or browser to see the result.

You can start editing the API by modifying \`src/http/health/route.ts\`. The server auto-updates as you edit the file.

This project uses built-in file-system routing to automatically map your \`src/http/\` structure to HTTP endpoints.

## Learn More

To learn more about Exis JS, take a look at the following resources:

- [Exis JS Documentation](https://github.com/v25group/exisjs/tree/main/docs) - learn about Exis JS features and API.
- [File-System Routing Guide](https://github.com/v25group/exisjs/blob/main/docs/02-routing.md) - learn how to structure your API.

You can check out [the Exis JS GitHub repository](https://github.com/v25group/exisjs) - your feedback and contributions are welcome!

## Deploy

The easiest way to deploy your Exis JS app is on any Node.js compatible hosting platform (Vercel, Render, Railway, DigitalOcean).
`
}

export function eslintTemplate(useTypeScript: boolean): string {
  if (useTypeScript) {
    return `import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['.exis/**', 'node_modules/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
);
`
  }
  return `import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['.exis/**', 'node_modules/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  eslintConfigPrettier,
];
`
}

export function agentsTemplate(): string {
  return `<!-- BEGIN:exisjs-agent-rules -->

# This is ExisJS

This repository uses **ExisJS**, a efficient TypeScript backend framework powered by a native Rust engine. 

ExisJS has highly specific architectural conventions, built-in subsystems, and routing paradigms that differ significantly from Express, NestJS, or traditional Node.js setups. 

Before writing any code or suggesting third-party libraries for Database, ORM, or Authentication:
1. Read the relevant official documentation located locally at \`node_modules/exisjs/docs/\`.
2. Familiarize yourself with the two supported routing paradigms: **Functional** (\`exisjs/router\`) and **Class-Based OOP** (\`exisjs/decorators\`). Always respect the paradigm currently established in the file.
3. Leverage the built-in Database Layer (Migrations, QueryBuilder) and the built-in Auth/OAuth systems instead of installing external libraries like Prisma, TypeORM, Passport, or NextAuth.

This block is generated by \`create-exis\`. Leaving it in your workspace ensures AI coding assistants maintain context and write idiomatic, efficient ExisJS code.

<!-- END:exisjs-agent-rules -->
`
}

export function prettierrcTemplate(): string {
  return `{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 80,
  "tabWidth": 2
}
`
}

export function prettierignoreTemplate(): string {
  return `.exis
node_modules
dist
coverage
`
}

export function commonAuthGuardTemplate(
  paradigm: string,
  useTypeScript: boolean
): string {
  const reqType = useTypeScript ? 'req: any' : 'req'
  if (paradigm === 'oop') {
    return `import { Injectable } from 'exisjs/decorators'

@Injectable()
export class AuthGuard {
  async canActivate(${reqType}) {
    // In a real app, verify the token here
    const token = req.headers.authorization
    if (!token) return false
    return true
  }
}
`
  }
  return `// Functional Guard Example
export const authGuard = async (${reqType}) => {
  const token = req.headers.authorization
  if (!token) return false
  return true
}
`
}

export function dbConnectionTemplate(_useTypeScript: boolean): string {
  return `// Example Database Configuration
// Import and configure ExisJS database or your preferred ORM here.

export const db = {
  connect: async () => {
    console.log('[Database] Connected successfully.')
  }
}
`
}

export function exampleJobTemplate(_useTypeScript: boolean): string {
  return `// Example Background Worker Job
// ExisJS will automatically mount this if enabled in exis.config.ts

export default {
  name: 'daily-cleanup',
  cron: '0 0 * * *', // Run at midnight
  async handle() {
    console.log('[Job] Running daily cleanup task...')
  }
}
`
}

export function userSchemaTemplate(useTypeScript: boolean): string {
  const importSchema = useTypeScript
    ? "import type { ResolveSchema } from 'exisjs/validator'\n"
    : ''
  return `${importSchema}import { tex } from 'exisjs/validator'

export const createUserSchema = tex.object({
  name: tex.string({ min: 1 }),
  email: tex.email(),
  password: tex.string({ min: 8 }),
})

export const userParamsSchema = tex.object({
  id: tex.string(),
})

${useTypeScript ? 'export type CreateUserDto = ResolveSchema<typeof createUserSchema>' : ''}
`
}

export function userServiceTemplate(
  paradigm: string,
  useTypeScript: boolean
): string {
  const isOop = paradigm === 'oop'
  const tsType = useTypeScript ? ': CreateUserDto' : ''
  const returnType = useTypeScript ? ': User' : ''

  if (isOop) {
    return `import { Injectable } from 'exisjs/decorators'
${useTypeScript ? "import type { CreateUserDto } from './schema'\n\nexport interface User {\n  id: number\n  name: string\n  email: string\n  createdAt: Date\n}\n" : ''}
@Injectable({ scope: 'singleton' })
export class UserService {
  private users${useTypeScript ? ': User[]' : ''} = []

  async create(userDto${tsType})${returnType} {
    const newUser = { 
      id: Date.now(), 
      createdAt: new Date(),
      ...userDto 
    }
    this.users.push(newUser)
    return newUser
  }

  async findAll() {
    return this.users
  }

  async findById(id: string) {
    return this.users.find((u) => String(u.id) === id) || null
  }
}
`
  }

  return `${useTypeScript ? "import type { CreateUserDto } from './schema'\n\nexport interface User {\n  id: number\n  name: string\n  email: string\n  createdAt: Date\n}\n" : ''}// In-memory user store
const users${useTypeScript ? ': User[]' : ''} = []

export async function createUser(userDto${tsType})${returnType} {
  const newUser = { 
    id: Date.now(), 
    createdAt: new Date(),
    ...userDto 
  }
  users.push(newUser)
  return newUser
}

export async function getUsers() {
  return users
}

export async function getUserById(id: string) {
  return users.find((u) => String(u.id) === id) || null
}
`
}

export function rootBoundaryTemplate(paradigm: string): string {
  if (paradigm === 'oop') {
    return `import { Boundary } from 'exisjs/decorators'
import type { Request, Response, Next, BoundaryContext } from 'exisjs/router'

@Boundary({
  cors: { origin: '*', credentials: true },
  headers: { 'X-Powered-By': 'ExisJS' },
})
export default class RootBoundary {
  // Named middleware running in declaration order before child routes
  logRequest(req: Request, res: Response, next: Next) {
    next()
  }

  // Wrapper around all requests in this boundary
  async handle(ctx: BoundaryContext, next: Next) {
    return next()
  }
}
`
  }

  return `import { defineBoundary } from 'exisjs/router'
import type { Request, Response, Next, BoundaryContext } from 'exisjs/router'

export const config = defineBoundary({
  cors: { origin: '*', credentials: true },
  headers: { 'X-Powered-By': 'ExisJS' },
})

// Named middleware running in declaration order before child routes
export function logRequest(req: Request, res: Response, next: Next) {
  next()
}

// Wrapper around all requests in this boundary
export default async function (ctx: BoundaryContext, next: Next) {
  return next()
}
`
}

export function userRouteTemplate(
  paradigm: string,
  useTypeScript: boolean
): string {
  const tsType = useTypeScript ? ': CreateUserDto' : ''

  if (paradigm === 'oop') {
    return `import { Controller, Get, Post, Body, Param } from 'exisjs/decorators'
import { UserService } from './service'
import { createUserSchema, userParamsSchema } from './schema'
${useTypeScript ? "import type { CreateUserDto } from './schema'\n" : ''}
@Controller()
export default class UsersController {
  constructor(private readonly userService: UserService) {}

  @Get('/')
  async getUsers() {
    return this.userService.findAll()
  }

  @Get('/:id', userParamsSchema)
  async getUserById(@Param('id') id: string) {
    return this.userService.findById(id)
  }

  @Post('/', createUserSchema)
  async createUser(@Body() body${tsType}) {
    return this.userService.create(body)
  }
}
`
  }

  return `import { controller, route } from 'exisjs/router'
import * as userService from './service'
import { createUserSchema, userParamsSchema } from './schema'

export default controller({
  getUsers: route.get('/', {
    async handle() {
      return userService.getUsers()
    }
  }),

  getUserById: route.get('/:id', {
    params: userParamsSchema,
    async handle({ params }) {
      return userService.getUserById(params.id)
    }
  }),

  createUser: route.post('/', {
    body: createUserSchema,
    async handle({ body }) {
      return userService.createUser(body)
    }
  })
})
`
}

export function userTestTemplate(_useTypeScript: boolean): string {
  return `import { test, expect, createTestApp } from 'exisjs/testing'
import config from '../exis.config'

test('Users API', async () => {
  const app = createTestApp(config)

  const res = await app.get('/users')

  expect(res.status).toBe(200)
  expect(Array.isArray(res.body)).toBe(true)
})
`
}
