import { c } from '../utils'

export async function exportsCommand() {
  console.log(`\n${c.bold}${c.green}ExisJS Exports Overview${c.reset}\n`)
  console.log(
    `The following subpath exports are available to import from ${c.cyan}'exisjs/*'\n`
  )

  const categories = [
    {
      name: 'Core Framework',
      items: [
        { path: 'exisjs', desc: 'Main entrypoint (cors, helmet, setup)' },
        { path: 'exisjs/app', desc: 'App lifecycle, workers, and resilience' },
        { path: 'exisjs/router', desc: 'Routing, controllers, and boundaries' },
        { path: 'exisjs/module', desc: 'Module and Boundary definitions' },
        { path: 'exisjs/di', desc: 'Dependency Injection container' },
        { path: 'exisjs/decorators', desc: 'Class-based routing decorators' },
        { path: 'exisjs/middleware', desc: 'Core middleware utilities' },
      ],
    },
    {
      name: 'Built-in Subsystems',
      items: [
        { path: 'exisjs/testing', desc: 'Native Test Runner Utilities' },
        { path: 'exisjs/validator', desc: 'Zod-like Schema Validation (tex)' },
        { path: 'exisjs/sanitize', desc: 'Input sanitization utilities' },
        { path: 'exisjs/logger', desc: 'Structured logging (pino-based)' },
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
