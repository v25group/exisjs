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
      exisjs: '^0.1.2',
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
      'typescript-eslint': '^8.0.0',
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
        baseUrl: '.',
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
    : `/** @type {import('exisjs/config').ExisConfig} */\nimport { env } from './env.js'\n\nconst config = {`

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

  test: {
    include: ['tests/**/*.test.ts']
  }
}

export default config
`
}

export function envTsTemplate(useTypeScript: boolean): string {
  if (useTypeScript) {
    return `import { v } from 'exisjs/validator'

export const env = v.env(v.object({
  PORT: v.string().optional(),
  NODE_ENV: v.enum(['development', 'production', 'test']).optional(),
  CORS_ORIGIN: v.string().optional(),
}))
`
  } else {
    return `import { v } from 'exisjs/validator'

export const env = v.env(v.object({
  PORT: v.string().optional(),
  NODE_ENV: v.enum(['development', 'production', 'test']).optional(),
  CORS_ORIGIN: v.string().optional(),
}))
`
  }
}

export function serverTemplate(): string {
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

export function healthRouteTemplate(): string {
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

export function rootRouteTemplate(): string {
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

export function eslintTemplate(): string {
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
