import fs from 'node:fs/promises'
import path from 'node:path'
import { success, error as logError } from '../utils'

export async function generateRoute(
  name: string,
  cwd = process.cwd(),
  options: { oop?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'http', name)

  try {
    const stat = await fs
      .stat(path.join(targetDir, 'route.ts'))
      .catch(() => null)
    if (stat) {
      logError(`Route ${name} already exists.`)
      return
    }
    await fs.mkdir(targetDir, { recursive: true })
  } catch {
    logError(`Could not create directory for ${name}`)
    return
  }

  // Convert names like "admin/posts" or "user-profiles" to PascalCase "AdminPosts" or "UserProfiles"
  const capitalizedName = name
    .split(/[/_-]+/) // Split by /, _, or -
    .filter(Boolean) // Remove empty strings that might result from leading/trailing slashes
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)) // Capitalize each part
    .join('') // Join them back together
  const isOop = options.oop

  if (isOop) {
    const hasTsConfig = await fs
      .stat(path.join(cwd, 'tsconfig.json'))
      .catch(() => null)
    if (!hasTsConfig) {
      logError(
        'Class-Based (OOP) routing requires TypeScript. No tsconfig.json found.'
      )
      return
    }
  }

  const schemaCode = `import { tex } from 'exisjs/validator'\n\nexport const Create${capitalizedName}Schema = tex.object({\n  name: tex.string()\n})\n`

  let gatewayCode: string
  let serviceCode: string
  let controllerCode: string
  let routeCode: string

  if (isOop) {
    gatewayCode = `import { Gateway } from 'exisjs/decorators'\n\n@Gateway()\nexport default class ${capitalizedName}Gateway {}\n`

    serviceCode = `import { Injectable } from 'exisjs/decorators'\n\n@Injectable()\nexport class ${capitalizedName}Service {\n  async create(data: { name: string }) {\n    return { id: Date.now(), name: data.name, created: true }\n  }\n\n  async list() {\n    return [{ id: 1, name: 'Sample ${capitalizedName}' }]\n  }\n}\n`

    // In OOP, the route file itself is the Controller!
    controllerCode = ''

    routeCode = `import { Controller, Get, Post, Body } from 'exisjs/decorators'\nimport { ${capitalizedName}Service } from './service'\n// import { Create${capitalizedName}Schema } from './schema'\n\n@Controller()\nexport default class ${capitalizedName}Controller {\n  constructor(private readonly service: ${capitalizedName}Service) {}\n\n  @Get('/')\n  async list() {\n    const result = await this.service.list()\n    return { success: true, data: result }\n  }\n\n  @Post('/')\n  async create(@Body() body: any /* use schema here */) {\n    const result = await this.service.create(body)\n    return { success: true, data: result }\n  }\n}\n`
  } else {
    gatewayCode = `import { defineGateway } from 'exisjs/router'\n\nexport default defineGateway({\n  // middlewares: [],\n})\n`

    serviceCode = `export async function create${capitalizedName}(data: { name: string }) {\n  // Add your database logic here\n  return { id: Date.now(), name: data.name, created: true }\n}\n\nexport async function get${capitalizedName}s() {\n  return [{ id: 1, name: 'Sample ${capitalizedName}' }]\n}\n`

    controllerCode = `import * as service from './service'\n\nexport async function create({ body }: any) {\n  const result = await service.create${capitalizedName}(body)\n  return { success: true, data: result }\n}\n\nexport async function list() {\n  const result = await service.get${capitalizedName}s()\n  return { success: true, data: result }\n}\n`

    routeCode = `import { controller, route } from 'exisjs/router'\nimport * as handler from './controller'\nimport * as schema from './schema'\n\nexport default controller({\n  list: route.get('/', {\n    handle: handler.list\n  }),\n  create: route.post('/', {\n    body: schema.Create${capitalizedName}Schema,\n    handle: handler.create\n  })\n})\n`
  }

  await fs.writeFile(path.join(targetDir, 'gateway.ts'), gatewayCode)
  await fs.writeFile(path.join(targetDir, 'schema.ts'), schemaCode)
  await fs.writeFile(path.join(targetDir, 'service.ts'), serviceCode)
  if (controllerCode) {
    await fs.writeFile(path.join(targetDir, 'controller.ts'), controllerCode)
  }
  await fs.writeFile(path.join(targetDir, 'route.ts'), routeCode)

  success(`Generated ${name} MVC structure in src/http/${name}/`)
}

export async function generatePlugin(name: string) {
  const targetDir = path.join(process.cwd(), 'src', 'plugins')

  try {
    await fs.mkdir(targetDir, { recursive: true })
  } catch {
    logError(`Could not create plugins directory`)
    return
  }

  const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1)

  const pluginCode = `import type { ExisPlugin } from 'exisjs'

export const ${capitalizedName}Plugin: ExisPlugin = {
  name: 'exis-${name.toLowerCase()}',
  version: '1.0.0',
  register: async (app, options) => {
    // Add isolated routes or middleware here
    // app.use((req, res, next) => { ... })
  }
}
`

  await fs.writeFile(
    path.join(targetDir, `${name.toLowerCase()}.ts`),
    pluginCode
  )
  success(`Generated ${name} plugin in src/plugins/${name.toLowerCase()}.ts`)
}

export async function generateMiddleware(name: string) {
  const targetDir = path.join(process.cwd(), 'src', 'middleware')

  try {
    await fs.mkdir(targetDir, { recursive: true })
  } catch {
    logError(`Could not create middleware directory`)
    return
  }

  const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1)

  const middlewareCode = `import type { Handler } from 'exisjs'

export const ${name}Middleware: Handler = (req, res, next) => {
  // Add your logic here
  console.log('${capitalizedName} Middleware executed')
  next()
}
`

  await fs.writeFile(
    path.join(targetDir, `${name.toLowerCase()}.ts`),
    middlewareCode
  )
  success(`Created middleware ${name} in src/middleware/${name}.ts`)
}

export async function generateTest(name: string) {
  const targetDir = path.join(process.cwd(), 'tests')

  try {
    await fs.mkdir(targetDir, { recursive: true })
  } catch {
    logError(`Could not create tests directory`)
    return
  }

  const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1)

  const testCode = `import { test, describe, assert, createTestContext } from 'exisjs/testing'
import app from '../src/http/server'
// import { ${capitalizedName} } from '../src/models/${capitalizedName}'

describe('${capitalizedName} Native Tests', () => {
  // Magically boot the framework, inject dependencies, and cleanup on exit
  createTestContext(app)

  test('should pass a basic test', async () => {
    // Write your test logic here
    assert.strictEqual(1 + 1, 2, 'Math works')
  })
})
`

  await fs.writeFile(
    path.join(targetDir, `${name.toLowerCase()}.test.ts`),
    testCode
  )
  success(`Generated ${name} test in tests/${name.toLowerCase()}.test.ts`)
}
