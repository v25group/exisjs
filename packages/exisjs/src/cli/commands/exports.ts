import { c } from '../utils'

export async function exportsCommand() {
  console.log(`\n${c.bold}${c.green}ExisJS Exports Overview${c.reset}\n`)
  console.log(
    `The following subpath exports are available to import from ${c.cyan}'exisjs/*'\n`
  )

  const categories = [
    {
      name: '🚀 Core Framework',
      items: [
        { path: 'exisjs', desc: 'Main entrypoint (cors, helmet, setup)' },
        { path: 'exisjs/app', desc: 'App lifecycle, workers, and resilience' },
        { path: 'exisjs/router', desc: 'Routing decorators and contexts' },
        { path: 'exisjs/module', desc: 'Module and Gateway definitions' },
        { path: 'exisjs/di', desc: 'Dependency Injection container' },
        { path: 'exisjs/decorators', desc: 'Class-based routing decorators' },
        { path: 'exisjs/middleware', desc: 'Core middleware utilities' },
      ],
    },
    {
      name: '⚙️ Built-in Subsystems',
      items: [
        { path: 'exisjs/auth', desc: 'Authentication, JWT, Passwords, RBAC' },
        { path: 'exisjs/cache', desc: 'Tag-based Cache Stores' },
        { path: 'exisjs/queue', desc: 'Background Job Queues & Workers' },
        { path: 'exisjs/testing', desc: 'Native Test Runner Utilities' },
        { path: 'exisjs/validator', desc: 'Zod-like Schema Validation (v)' },
        { path: 'exisjs/dataloader', desc: 'GraphQL-style Dataloaders' },
        { path: 'exisjs/observability', desc: 'Metrics, Tracing, Health' },
        { path: 'exisjs/swagger', desc: 'Auto-generated OpenAPI docs' },
      ],
    },
    {
      name: 'Utilities',
      items: [
        { path: 'exisjs/config', desc: 'Dynamic configuration loading' },
        { path: 'exisjs/error', desc: 'Global exception formatting' },
        { path: 'exisjs/plugin', desc: 'Plugin isolation wrapper' },
        { path: 'exisjs/response', desc: 'Standardized JSON responses' },
      ],
    },
    {
      name: 'Adapters',
      items: [
        { path: 'exisjs/adapters', desc: 'Edge and Serverless polyfills' },
      ],
    },
    {
      name: 'Integrations',
      items: [
        { path: 'exisjs/drizzle', desc: 'Drizzle ORM' },
        { path: 'exisjs/jwt', desc: 'JSON Web Tokens' },
        { path: 'exisjs/mongodb', desc: 'MongoDB Native' },
        { path: 'exisjs/mongoose', desc: 'Mongoose ODM' },
        { path: 'exisjs/openai', desc: 'OpenAI SDK' },
        { path: 'exisjs/postgres', desc: 'PostgreSQL Native' },
        { path: 'exisjs/posthog', desc: 'PostHog Analytics' },
        { path: 'exisjs/prisma', desc: 'Prisma Client' },
        { path: 'exisjs/redis', desc: 'ioredis' },
        { path: 'exisjs/resend', desc: 'Resend Email API' },
        { path: 'exisjs/s3', desc: 'AWS S3 Client' },
        { path: 'exisjs/supabase', desc: 'Supabase JS' },
      ],
    },
  ]

  for (const category of categories) {
    console.log(`${c.bold}${c.magenta}${category.name}${c.reset}`)
    for (const item of category.items) {
      console.log(
        `  ${c.cyan}${item.path.padEnd(25)}${c.reset} ${c.dim}- ${item.desc}${c.reset}`
      )
    }
    console.log()
  }
}
