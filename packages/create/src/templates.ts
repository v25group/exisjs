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
      exisjs: '^0.6.0',
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
      eslint: '^9.9.0',
      '@eslint/js': '^9.9.0',
      'eslint-config-prettier': '^9.1.0',
    }
    if (useTypeScript) {
      pkg.devDependencies['typescript-eslint'] = '^8.0.0'
    }
  }

  return JSON.stringify(pkg, null, 2)
}

export function tsconfigTemplate(useSrc: boolean, alias: string): string {
  const aliasPath = useSrc ? './src/*' : './*'
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
          [alias]: [aliasPath],
        },
      },
      include: ['**/*.ts'],
      exclude: ['node_modules', '.exis'],
    },
    null,
    2
  )
}

export function exisConfigTemplate(useTypeScript: boolean): string {
  const importStatement = useTypeScript
    ? `import type { ExisConfig } from 'exisjs/config'\nimport { env } from './config/env'\n\nconst config: ExisConfig = {`
    : `/** @type {import('exisjs/config').ExisConfig} */\nimport { env } from './config/env'\n\nconst config = {`

  return `${importStatement}
  port: Number(env.PORT) || 4000,
  host: '0.0.0.0',

  cors: {
    origin: env.CORS_ORIGIN || '*',
    credentials: true,
  },

  logger: {
    level: 'info',
    pretty: env.NODE_ENV !== 'production',
  },

  helmet: { enabled: true },

  // Set to true if you need to use getContext() globally in production
  asyncContext: false,

  test: {
    include: ['tests/**/*.test.ts']
  }
}

export default config
`
}

export function envTsTemplate(useTypeScript: boolean): string {
  if (useTypeScript) {
    return `import { tex } from 'exisjs/validator'

export const env = tex.object({
  PORT: tex.number({ coerce: true, optional: true }),
  NODE_ENV: tex.enum(['development', 'production', 'test'], { optional: true }),
  CORS_ORIGIN: tex.string({ optional: true }),
}).parse(process.env)
`
  } else {
    return `import { tex } from 'exisjs/validator'

export const env = tex.object({
  PORT: tex.number({ coerce: true, optional: true }),
  NODE_ENV: tex.enum(['development', 'production', 'test'], { optional: true }),
  CORS_ORIGIN: tex.string({ optional: true }),
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

# Exis JS Cache
.exis/

# dependencies
/node_modules
/.pnp
.pnp.*
.yarn/*
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/versions

# testing
/coverage

# misc
.DS_Store
*.pem

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# env files (can opt-in for committing if needed)
.env*

# typescript
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

export function userDtoTemplate(useTypeScript: boolean): string {
  return `import { tex } from 'exisjs/validator'

export const createUserSchema = tex.object({
  name: tex.string(),
  email: tex.string().email(),
  password: tex.string().min(8),
})

${useTypeScript ? 'export type CreateUserDto = tex.infer<typeof createUserSchema>' : ''}
`
}

export function userEntityTemplate(useTypeScript: boolean): string {
  const typeDef = useTypeScript
    ? 'export interface User {\n  id: number;\n  name: string;\n  email: string;\n  createdAt: Date;\n}\n\n'
    : ''
  return `${typeDef}// Example Database Entity Model
// In a real app, you would use ExisJS Database ORM here.
export const usersTableName = 'users';
`
}

export function userServiceTemplate(
  paradigm: string,
  useTypeScript: boolean
): string {
  const isOop = paradigm === 'oop'
  const tsType = useTypeScript ? ': CreateUserDto' : ''

  if (isOop) {
    return `import { Injectable } from 'exisjs/decorators'
${useTypeScript ? "import type { CreateUserDto } from './dto/create-user.dto'\nimport type { User } from './entities/user.entity'" : ''}

@Injectable()
export class UserService {
  // In a real app, inject the Database service here.
  private users${useTypeScript ? ': User[]' : ''} = []

  async create(userDto${tsType}) {
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
}
`
  }

  return `${useTypeScript ? "import type { CreateUserDto } from './dto/create-user.dto'\nimport type { User } from './entities/user.entity'\n" : ''}
// Functional Service Example
export class UserService {
  private users${useTypeScript ? ': User[]' : ''} = []

  async create(userDto${tsType}) {
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
}
`
}

export function userGatewayTemplate(paradigm: string): string {
  if (paradigm === 'oop') {
    return `import { Gateway } from 'exisjs/decorators'
import { UserService } from './user.service'

// The Gateway acts as a Module, providing the UserService to all routes in this folder.
@Gateway({
  providers: [
    ['UserService', { useClass: UserService }]
  ]
})
export default class UsersGateway {}
`
  }

  return `import { defineGateway } from 'exisjs'
import { UserService } from './user.service'

export default defineGateway({
  providers: [
    ['UserService', { useClass: UserService }]
  ]
})
`
}

export function userRouteTemplate(
  paradigm: string,
  useTypeScript: boolean
): string {
  const tsType = useTypeScript ? ': any' : ''

  if (paradigm === 'oop') {
    return `import { Controller, Get, Post, Body, Inject } from 'exisjs/decorators'
import { UserService } from './user.service'
import { createUserSchema } from './dto/create-user.dto'

@Controller()
export default class UsersController {
  constructor(
    @Inject('UserService') private userService: UserService
  ) {}

  @Get('/')
  async getUsers() {
    return this.userService.findAll()
  }

  @Post('/', { body: createUserSchema })
  async createUser(@Body() body${tsType}) {
    return this.userService.create(body)
  }
}
`
  }

  return `import { controller, route } from 'exisjs/router'
import { UserService } from './user.service'
import { createUserSchema } from './dto/create-user.dto'

export default controller({
  getUsers: route.get('/', {
    async handle(req) {
      // In functional mode, we inject dependencies from the request context
      const userService = req.inject('UserService')
      return userService.findAll()
    }
  }),

  createUser: route.post('/', {
    body: createUserSchema,
    async handle(req) {
      const userService = req.inject('UserService')
      return userService.create(req.body)
    }
  })
})
`
}

export function userTestTemplate(_useTypeScript: boolean): string {
  return `import { test, expect } from 'vitest'
import { createTestApp } from 'exisjs/testing'
import config from '../exis.config'

test('Users API', async () => {
  const app = await createTestApp(config)

  const res = await app.request('/users', {
    method: 'GET'
  })

  expect(res.status).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body)).toBe(true)
})
`
}
