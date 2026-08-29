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
  }

  if (useEslint) {
    scripts.lint = 'eslint .'
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
      exisjs: '^0.5.12',
    },
  }

  if (useTypeScript) {
    pkg.devDependencies = {
      '@types/node': '^20.0.0',
      typescript: '^5.5.0',
    }
  }

  if (useEslint) {
    pkg.devDependencies = {
      ...(pkg.devDependencies || {}),
      eslint: '^9.9.0',
      '@eslint/js': '^9.9.0',
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
    ? `import type { ExisConfig } from 'exisjs/config'\nimport { env } from './env'\n\nconst config: ExisConfig = {`
    : `/** @type {import('exisjs/config').ExisConfig} */\nimport { env } from './env'\n\nconst config = {`

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

export default tseslint.config(
  {
    ignores: ['.exis/**', 'node_modules/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
);
`
  }
  return `import eslint from '@eslint/js';

export default [
  {
    ignores: ['.exis/**', 'node_modules/**', 'coverage/**'],
  },
  eslint.configs.recommended,
];
`
}

export function agentsTemplate(): string {
  return `<!-- BEGIN:exisjs-agent-rules -->

# This is ExisJS

This repository uses **ExisJS**, an ultra-high performance TypeScript backend framework powered by a native Rust engine. 

ExisJS has highly specific architectural conventions, built-in subsystems, and routing paradigms that differ significantly from Express, NestJS, or traditional Node.js setups. 

Before writing any code or suggesting third-party libraries for Database, ORM, or Authentication:
1. Read the relevant official documentation located locally at \`node_modules/exisjs/docs/\`.
2. Familiarize yourself with the two supported routing paradigms: **Functional** (\`exisjs/router\`) and **Class-Based OOP** (\`exisjs/decorators\`). Always respect the paradigm currently established in the file.
3. Leverage the built-in Database Layer (Migrations, QueryBuilder) and the built-in Auth/OAuth systems instead of installing external libraries like Prisma, TypeORM, Passport, or NextAuth.

This block is generated by \`create-exis\`. Leaving it in your workspace ensures AI coding assistants maintain context and write idiomatic, high-performance ExisJS code.

<!-- END:exisjs-agent-rules -->
`
}
