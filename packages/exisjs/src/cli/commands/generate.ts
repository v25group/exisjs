import fs from 'node:fs/promises'
import path from 'node:path'
import { success, error as logError } from '../utils'

function toPascalCase(name: string) {
  return name
    .split(/[/_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

async function ensureDir(dir: string) {
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch {
    logError(`Could not create directory ${dir}`)
    process.exit(1)
  }
}

export async function generateController(
  name: string,
  cwd = process.cwd(),
  options: { oop?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'http', name)
  await ensureDir(targetDir)
  const filePath = path.join(targetDir, 'route.ts')
  try {
    const stat = await fs.stat(filePath)
    if (stat.isFile()) {
      logError(`Route already exists at ${filePath}`)
      process.exit(1)
    }
  } catch {
    // File doesn't exist, proceed
  }
  const capitalizedName = toPascalCase(name)

  const code = options.oop
    ? `import { Controller, Get } from 'exisjs/decorators'\n\n@Controller('/${name}')\nexport default class ${capitalizedName}Controller {\n  @Get('/')\n  async list() {\n    return { success: true, data: [] }\n  }\n}\n`
    : `import { controller, route } from 'exisjs/router'\n\nexport default controller({\n  list: route.get('/', {\n    handle: async () => {\n      return { success: true, data: [] }\n    }\n  })\n})\n`

  await fs.writeFile(filePath, code)
  success(
    `Generated ${options.oop ? 'OOP' : 'Functional'} route in src/http/${name}/route.ts`
  )
}

export async function generateService(
  name: string,
  cwd = process.cwd(),
  options: { oop?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'http', name)
  await ensureDir(targetDir)
  const capitalizedName = toPascalCase(name)

  const code = options.oop
    ? `import { Injectable } from 'exisjs/decorators'\n\n@Injectable({ scope: 'singleton' })\nexport class ${capitalizedName}Service {\n  async list() {\n    return []\n  }\n}\n`
    : `export async function get${capitalizedName}s() {\n  return []\n}\n`

  await fs.writeFile(path.join(targetDir, 'service.ts'), code)
  success(
    `Generated ${options.oop ? 'OOP' : 'Functional'} service in src/http/${name}/service.ts`
  )
}

export async function generateSchema(name: string, cwd = process.cwd()) {
  const targetDir = path.join(cwd, 'src', 'http', name)
  await ensureDir(targetDir)
  const capitalizedName = toPascalCase(name)

  const code = `import { tex } from 'exisjs/validator'\nimport type { ResolveSchema } from 'exisjs/validator'\n\nexport const ${capitalizedName}ParamsSchema = tex.object({\n  id: tex.string(),\n})\n\nexport const Create${capitalizedName}Schema = tex.object({\n  name: tex.string({ min: 1 }),\n})\n\nexport type Create${capitalizedName}Dto = ResolveSchema<typeof Create${capitalizedName}Schema>\n`

  await fs.writeFile(path.join(targetDir, 'schema.ts'), code)
  success(`Generated validation schema in src/http/${name}/schema.ts`)
}

export async function generateBoundary(
  name: string,
  cwd = process.cwd(),
  options: { oop?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'http', name)
  await ensureDir(targetDir)
  const capitalizedName = toPascalCase(name)

  const code = options.oop
    ? `import { Boundary } from 'exisjs/decorators'\nimport type { Request, Response, Next, BoundaryContext } from 'exisjs/router'\n\n@Boundary({\n  cors: { origin: ['*'], credentials: true },\n  headers: { 'X-Powered-By': 'ExisJS' },\n})\nexport default class ${capitalizedName}Boundary {\n  // Named chain step auto-detected by (req, res, next) signature\n  // auth(req: Request, res: Response, next: Next) {\n  //   next()\n  // }\n\n  // Wrapper around all routes and child boundaries\n  async handle(ctx: BoundaryContext, next: Next) {\n    return next()\n  }\n}\n`
    : `import { defineBoundary } from 'exisjs/router'\nimport type { Request, Response, Next, BoundaryContext } from 'exisjs/router'\n\nexport const config = defineBoundary({\n  cors: { origin: ['*'], credentials: true },\n  headers: { 'X-Powered-By': 'ExisJS' },\n  // exclude: [{ path: '/health', method: 'GET' }],\n})\n\n// Named chain step: auto-detected by (req, res, next) signature\n// export function auth(req: Request, res: Response, next: Next) {\n//   next()\n// }\n\n// Pipeline wrapper: auto-detected as default export with (ctx, next) signature\nexport default async function (ctx: BoundaryContext, next: Next) {\n  return next()\n}\n`

  await fs.writeFile(path.join(targetDir, 'boundary.ts'), code)
  success(
    `Generated ${options.oop ? 'OOP' : 'Functional'} boundary in src/http/${name}/boundary.ts`
  )
}

export async function generateResource(
  name: string,
  cwd = process.cwd(),
  options: { oop?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'http', name)
  await ensureDir(targetDir)
  const capitalizedName = toPascalCase(name)

  // 1. Generate schema.ts
  await generateSchema(name, cwd)

  // 2. Generate boundary.ts
  await generateBoundary(name, cwd, options)

  // 3. Generate service.ts
  await generateService(name, cwd, options)

  // 4. Generate route.ts
  const routeCode = options.oop
    ? `import { Controller, Get, Post, Body, Param } from 'exisjs/decorators'\nimport { ${capitalizedName}Service } from './service'\nimport { Create${capitalizedName}Schema, ${capitalizedName}ParamsSchema } from './schema'\nimport type { Create${capitalizedName}Dto } from './schema'\n\n@Controller('/${name}')\nexport default class ${capitalizedName}Controller {\n  constructor(private readonly service: ${capitalizedName}Service) {}\n\n  @Get('/')\n  async list() {\n    const data = await this.service.list()\n    return { success: true, data }\n  }\n\n  @Get('/:id', ${capitalizedName}ParamsSchema)\n  async getById(@Param('id') id: string) {\n    return { success: true, id }\n  }\n\n  @Post('/', Create${capitalizedName}Schema)\n  async create(@Body() body: Create${capitalizedName}Dto) {\n    return { success: true, data: body }\n  }\n}\n`
    : `import { controller, route } from 'exisjs/router'\nimport * as service from './service'\nimport { Create${capitalizedName}Schema, ${capitalizedName}ParamsSchema } from './schema'\n\nexport default controller({\n  list: route.get('/', {\n    handle: async () => {\n      const data = await service.get${capitalizedName}s()\n      return { success: true, data }\n    }\n  }),\n\n  getById: route.get('/:id', {\n    params: ${capitalizedName}ParamsSchema,\n    handle: async ({ params }) => {\n      return { success: true, id: params.id }\n    }\n  }),\n\n  create: route.post('/', {\n    body: Create${capitalizedName}Schema,\n    handle: async ({ body }) => {\n      return { success: true, data: body }\n    }\n  })\n})\n`

  await fs.writeFile(path.join(targetDir, 'route.ts'), routeCode)
  success(
    `Generated ${options.oop ? 'OOP' : 'Functional'} resource slice in src/http/${name}/`
  )
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

describe('${capitalizedName} Native Tests', () => {
  // Automatically boot the framework and cleanup on exit
  createTestContext(app)

  test('should pass a basic test', async () => {
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
