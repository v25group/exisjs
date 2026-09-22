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
  options: { oop?: boolean; named?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'http', name)
  await ensureDir(targetDir)
  const filename = options.named ? `${name}.route.ts` : 'route.ts'
  const filePath = path.join(targetDir, filename)
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
    `Generated ${options.oop ? 'OOP' : 'Functional'} route in src/http/${name}/${filename}`
  )
}

export async function generateModel(
  name: string,
  cwd = process.cwd(),
  options: { named?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'models')
  await ensureDir(targetDir)
  const capitalizedName = toPascalCase(name)
  const filename = options.named ? `${name}.model.ts` : `${capitalizedName}.ts`

  const code = `export interface ${capitalizedName} {
  id: string
  name: string
  description?: string
  createdAt?: Date
  updatedAt?: Date
}

export type Create${capitalizedName}Input = Omit<${capitalizedName}, 'id' | 'createdAt' | 'updatedAt'>
export type Update${capitalizedName}Input = Partial<Create${capitalizedName}Input>
`

  await fs.writeFile(path.join(targetDir, filename), code)
  success(`Generated database-agnostic model in src/models/${filename}`)
}

export async function generateService(
  name: string,
  cwd = process.cwd(),
  options: { oop?: boolean; named?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'http', name)
  await ensureDir(targetDir)
  const capitalizedName = toPascalCase(name)
  const filename = options.named ? `${name}.service.ts` : 'service.ts'
  const schemaFile = options.named ? `./${name}.schema` : './schema'

  const code = options.oop
    ? `import { Injectable } from 'exisjs/decorators'
import { paginate, getPaginationSkip } from 'exisjs'
import type { Create${capitalizedName}Dto, Update${capitalizedName}Dto } from '${schemaFile}'

@Injectable({ scope: 'singleton' })
export class ${capitalizedName}Service {
  async list(query: { page?: number; limit?: number } = {}) {
    const { skip, limit, page } = getPaginationSkip(query)
    // Add your database query logic here (PostgreSQL, MySQL, SQLite, MongoDB, etc.)
    const items: any[] = []
    const total = 0
    return paginate(items, total, { page, limit })
  }

  async getById(id: string) {
    // Fetch record by id from your database
    return { id, name: '${capitalizedName} #' + id }
  }

  async create(data: Create${capitalizedName}Dto) {
    // Insert record into your database
    return { id: String(Date.now()), ...data }
  }

  async update(id: string, data: Update${capitalizedName}Dto) {
    // Update record in your database
    return { id, ...data }
  }

  async delete(id: string) {
    // Delete record from your database
    return true
  }
}
`
    : `import { paginate, getPaginationSkip } from 'exisjs'
import type { Create${capitalizedName}Dto, Update${capitalizedName}Dto } from '${schemaFile}'

export async function get${capitalizedName}s(query: { page?: number; limit?: number } = {}) {
  const { skip, limit, page } = getPaginationSkip(query)
  // Add your database query logic here (PostgreSQL, MySQL, SQLite, MongoDB, etc.)
  const items: any[] = []
  const total = 0
  return paginate(items, total, { page, limit })
}

export async function get${capitalizedName}ById(id: string) {
  // Fetch record by id from your database
  return { id, name: '${capitalizedName} #' + id }
}

export async function create${capitalizedName}(data: Create${capitalizedName}Dto) {
  // Insert record into your database
  return { id: String(Date.now()), ...data }
}

export async function update${capitalizedName}(id: string, data: Update${capitalizedName}Dto) {
  // Update record in your database
  return { id, ...data }
}

export async function delete${capitalizedName}(id: string) {
  // Delete record from your database
  return true
}
`

  await fs.writeFile(path.join(targetDir, filename), code)
  success(
    `Generated ${options.oop ? 'OOP' : 'Functional'} service in src/http/${name}/${filename}`
  )
}

export async function generateSchema(
  name: string,
  cwd = process.cwd(),
  options: { named?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'http', name)
  await ensureDir(targetDir)
  const capitalizedName = toPascalCase(name)
  const filename = options.named ? `${name}.schema.ts` : 'schema.ts'

  const code = `import { tex } from 'exisjs/validator'
import type { ResolveSchema } from 'exisjs/validator'

export const ${capitalizedName}ParamsSchema = tex.object({
  id: tex.string(),
})

export const ${capitalizedName}PaginationSchema = tex.pagination({
  defaultLimit: 20,
  maxLimit: 100,
})

export const Create${capitalizedName}Schema = tex.object({
  name: tex.string({ min: 1 }),
  description: tex.string({ optional: true }),
})

export const Update${capitalizedName}Schema = tex.object({
  name: tex.string({ min: 1, optional: true }),
  description: tex.string({ optional: true }),
})

export type ${capitalizedName}ParamsDto = ResolveSchema<typeof ${capitalizedName}ParamsSchema>
export type Create${capitalizedName}Dto = ResolveSchema<typeof Create${capitalizedName}Schema>
export type Update${capitalizedName}Dto = ResolveSchema<typeof Update${capitalizedName}Schema>
`

  await fs.writeFile(path.join(targetDir, filename), code)
  success(`Generated validation schema in src/http/${name}/${filename}`)
}

export async function generateBoundary(
  name: string,
  cwd = process.cwd(),
  options: { oop?: boolean; named?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'http', name)
  await ensureDir(targetDir)
  const filename = options.named ? `${name}.boundary.ts` : 'boundary.ts'
  const filePath = path.join(targetDir, filename)

  const capitalizedName = toPascalCase(name)
  const code = options.oop
    ? `import { Boundary } from 'exisjs/decorators'\n\n@Boundary()\nexport default class ${capitalizedName}Boundary {}\n`
    : `import { defineBoundary } from 'exisjs/router'\n\nexport default defineBoundary({\n  // middlewares: [],\n})\n`

  await fs.writeFile(filePath, code)
  success(`Generated boundary in src/http/${name}/${filename}`)
}

export async function generateErrorHandler(
  cwd = process.cwd(),
  options: { oop?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'http')
  await ensureDir(targetDir)
  const filePath = path.join(targetDir, 'error.ts')

  const code = options.oop
    ? `import type { Request, Response } from 'exisjs'

/**
 * Global Exception Handler for ExisJS (OOP Paradigm)
 * Auto-mounted by the framework to catch unhandled errors and format error responses.
 */
export default class GlobalErrorHandler {
  onError(err: any, req: Request, res: Response) {
    const status = err.statusCode || err.status || 500
    res.status(status).json({
      success: false,
      error: {
        message: err.message || 'Internal Server Error',
        code: err.code || 'INTERNAL_ERROR',
      },
    })
  }
}
`
    : `import type { Request, Response } from 'exisjs'

/**
 * Global Exception Handler for ExisJS
 * Auto-mounted by the framework to catch unhandled errors and format error responses.
 */
export function onError(err: any, req: Request, res: Response) {
  const status = err.statusCode || err.status || 500
  res.status(status).json({
    success: false,
    error: {
      message: err.message || 'Internal Server Error',
      code: err.code || 'INTERNAL_ERROR',
    },
  })
}
`

  await fs.writeFile(filePath, code)
  success('Generated global exception handler in src/http/error.ts')
}

export async function generateCronJob(
  name: string,
  cwd = process.cwd(),
  options: { oop?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'cron')
  await ensureDir(targetDir)
  const filename = `${name.toLowerCase()}.ts`
  const filePath = path.join(targetDir, filename)
  const capitalizedName = toPascalCase(name)

  const code = options.oop
    ? `import { Injectable, Cron, CronExpression } from 'exisjs/decorators'

@Injectable()
export default class ${capitalizedName}Job {
  @Cron(CronExpression.EVERY_HOUR, {
    name: '${name.toLowerCase()}',
    preventOverlap: true,
  })
  async handle() {
    console.log('[cron] Executing ${capitalizedName}Job')
  }
}
`
    : `import { cron, CronExpression } from 'exisjs/cron'

export default cron({
  name: '${name.toLowerCase()}',
  schedule: CronExpression.EVERY_HOUR,
  preventOverlap: true,
  async run({ log }) {
    log.info('[cron] Executing ${name.toLowerCase()} job')
  },
})
`

  await fs.writeFile(filePath, code)
  success(`Generated cron job in src/cron/${filename}`)
}

export async function generateResource(
  name: string,
  cwd = process.cwd(),
  options: { oop?: boolean; named?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'http', name)
  await ensureDir(targetDir)
  const capitalizedName = toPascalCase(name)

  const schemaFile = options.named ? `./${name}.schema` : './schema'
  const serviceFile = options.named ? `./${name}.service` : './service'
  const routeFilename = options.named ? `${name}.route.ts` : 'route.ts'
  const schemaFilename = options.named ? `${name}.schema.ts` : 'schema.ts'
  const serviceFilename = options.named ? `${name}.service.ts` : 'service.ts'
  const modelFilename = `${capitalizedName}.ts`

  // 1. Generate model
  await generateModel(name, cwd, options)

  // 2. Generate schema
  await generateSchema(name, cwd, options)

  // 3. Generate service
  await generateService(name, cwd, options)

  // 4. Generate full CRUD route
  const routeCode = options.oop
    ? `import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from 'exisjs/decorators'
import { ${capitalizedName}Service } from '${serviceFile}'
import {
  Create${capitalizedName}Schema,
  Update${capitalizedName}Schema,
  ${capitalizedName}ParamsSchema,
  ${capitalizedName}PaginationSchema,
} from '${schemaFile}'
import type { Create${capitalizedName}Dto, Update${capitalizedName}Dto } from '${schemaFile}'

@Controller('/${name}')
export default class ${capitalizedName}Controller {
  constructor(private readonly service: ${capitalizedName}Service) {}

  @Get('/', { query: ${capitalizedName}PaginationSchema })
  async list(@Query() query: any) {
    const result = await this.service.list(query)
    return { success: true, ...result }
  }

  @Get('/:id', { params: ${capitalizedName}ParamsSchema })
  async getById(@Param('id') id: string) {
    const item = await this.service.getById(id)
    if (!item) return { success: false, error: 'Not found' }
    return { success: true, data: item }
  }

  @Post('/', { body: Create${capitalizedName}Schema })
  async create(@Body() body: Create${capitalizedName}Dto) {
    const item = await this.service.create(body)
    return { success: true, data: item }
  }

  @Patch('/:id', { params: ${capitalizedName}ParamsSchema, body: Update${capitalizedName}Schema })
  async update(@Param('id') id: string, @Body() body: Update${capitalizedName}Dto) {
    const item = await this.service.update(id, body)
    return { success: true, data: item }
  }

  @Delete('/:id', { params: ${capitalizedName}ParamsSchema })
  async delete(@Param('id') id: string) {
    await this.service.delete(id)
    return { success: true, message: 'Deleted successfully' }
  }
}
`
    : `import { controller, route } from 'exisjs/router'
import * as service from '${serviceFile}'
import {
  Create${capitalizedName}Schema,
  Update${capitalizedName}Schema,
  ${capitalizedName}ParamsSchema,
  ${capitalizedName}PaginationSchema,
} from '${schemaFile}'

export default controller({
  list: route.get('/', {
    query: ${capitalizedName}PaginationSchema,
    handle: async ({ query }) => {
      const result = await service.get${capitalizedName}s(query)
      return { success: true, ...result }
    },
  }),

  getById: route.get('/:id', {
    params: ${capitalizedName}ParamsSchema,
    handle: async ({ params }) => {
      const item = await service.get${capitalizedName}ById(params.id)
      if (!item) return { success: false, error: 'Not found' }
      return { success: true, data: item }
    },
  }),

  create: route.post('/', {
    body: Create${capitalizedName}Schema,
    handle: async ({ body }) => {
      const item = await service.create${capitalizedName}(body)
      return { success: true, data: item }
    },
  }),

  update: route.patch('/:id', {
    params: ${capitalizedName}ParamsSchema,
    body: Update${capitalizedName}Schema,
    handle: async ({ params, body }) => {
      const item = await service.update${capitalizedName}(params.id, body)
      return { success: true, data: item }
    },
  }),

  remove: route.delete('/:id', {
    params: ${capitalizedName}ParamsSchema,
    handle: async ({ params }) => {
      await service.delete${capitalizedName}(params.id)
      return { success: true, message: 'Deleted successfully' }
    },
  }),
})
`

  await fs.writeFile(path.join(targetDir, routeFilename), routeCode)
  success(
    `Generated full 4-file CRUD slice in src/http/${name}/ and src/models/${modelFilename} (${routeFilename}, ${schemaFilename}, ${serviceFilename}, ${modelFilename})`
  )
}

export const generateCrud = generateResource

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
