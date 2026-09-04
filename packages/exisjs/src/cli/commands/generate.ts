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
    ? `import { Controller, Get, Post, Body } from 'exisjs/decorators'\n\n@Controller()\nexport default class ${capitalizedName}Controller {\n  @Get('/')\n  async list() { return { success: true, data: [] } }\n}\n`
    : `import { controller, route } from 'exisjs/router'\n\nexport default controller({\n  list: route.get('/', {\n    handle: async () => { return { success: true, data: [] } }\n  })\n})\n`

  await fs.writeFile(filePath, code)
  success(
    `Generated ${options.oop ? 'OOP' : 'Functional'} controller in src/http/${name}/route.ts`
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
    ? `import { Injectable } from 'exisjs/decorators'\n\n@Injectable()\nexport class ${capitalizedName}Service {\n  async list() { return [] }\n}\n`
    : `export async function get${capitalizedName}s() { return [] }\n`

  await fs.writeFile(path.join(targetDir, 'service.ts'), code)
  success(
    `Generated ${options.oop ? 'OOP' : 'Functional'} service in src/http/${name}/service.ts`
  )
}

export async function generateGateway(
  name: string,
  cwd = process.cwd(),
  options: { oop?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'http', name)
  await ensureDir(targetDir)
  const capitalizedName = toPascalCase(name)

  const code = options.oop
    ? `import { Gateway } from 'exisjs/decorators'\n\n@Gateway()\nexport default class ${capitalizedName}Gateway {}\n`
    : `import { defineGateway } from 'exisjs/router'\n\nexport default defineGateway({\n  // middlewares: [],\n})\n`

  await fs.writeFile(path.join(targetDir, 'gateway.ts'), code)
  success(
    `Generated ${options.oop ? 'OOP' : 'Functional'} gateway in src/http/${name}/gateway.ts`
  )
}

export async function generateGuard(
  name: string,
  cwd = process.cwd(),
  options: { oop?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'common', 'guards')
  await ensureDir(targetDir)
  const capitalizedName = toPascalCase(name)

  const code = options.oop
    ? `import { Injectable } from 'exisjs/decorators'\nimport type { Request } from 'exisjs'\n\n@Injectable()\nexport class ${capitalizedName}Guard {\n  async canActivate(req: Request): Promise<boolean> {\n    return true\n  }\n}\n`
    : `import type { Request } from 'exisjs'\n\nexport async function ${name}Guard(req: Request): Promise<boolean> {\n  return true\n}\n`

  await fs.writeFile(path.join(targetDir, `${name}.guard.ts`), code)
  success(`Generated guard in src/common/guards/${name}.guard.ts`)
}

export async function generateInterceptor(
  name: string,
  cwd = process.cwd(),
  options: { oop?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'common', 'interceptors')
  await ensureDir(targetDir)
  const capitalizedName = toPascalCase(name)

  const code = options.oop
    ? `import { Injectable } from 'exisjs/decorators'\nimport type { Request, Response } from 'exisjs'\n\n@Injectable()\nexport class ${capitalizedName}Interceptor {\n  async intercept(req: Request, res: Response) {\n    // Intercept logic here\n  }\n}\n`
    : `import type { Request, Response } from 'exisjs'\n\nexport async function ${name}Interceptor(req: Request, res: Response) {\n  // Intercept logic here\n}\n`

  await fs.writeFile(path.join(targetDir, `${name}.interceptor.ts`), code)
  success(
    `Generated interceptor in src/common/interceptors/${name}.interceptor.ts`
  )
}

export async function generateFilter(
  name: string,
  cwd = process.cwd(),
  options: { oop?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'common', 'filters')
  await ensureDir(targetDir)
  const capitalizedName = toPascalCase(name)

  const code = options.oop
    ? `import { Injectable } from 'exisjs/decorators'\n\n@Injectable()\nexport class ${capitalizedName}Filter {\n  async catch(error: any, ctx: { req: any; res: any }) {\n    ctx.res.status(500).json({ success: false, message: error.message })\n  }\n}\n`
    : `export async function ${name}Filter(error: any, ctx: { req: any; res: any }) {\n  ctx.res.status(500).json({ success: false, message: error.message })\n}\n`

  await fs.writeFile(path.join(targetDir, `${name}.filter.ts`), code)
  success(`Generated filter in src/common/filters/${name}.filter.ts`)
}

export async function generateJob(
  name: string,
  cwd = process.cwd(),
  _options: { oop?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'jobs')
  await ensureDir(targetDir)

  const code = `import type { JobHandler } from 'exisjs'\n\nexport const name = '${name}-job'\n\nexport const handle: JobHandler<any> = async (payload, { log }) => {\n  log.info('Running ${name} job', payload)\n}\n`

  await fs.writeFile(path.join(targetDir, `${name}.job.ts`), code)
  success(`Generated job in src/jobs/${name}.job.ts`)
}

export async function generateResource(
  name: string,
  cwd = process.cwd(),
  options: { oop?: boolean } = {}
) {
  const targetDir = path.join(cwd, 'src', 'http', name)
  await ensureDir(targetDir)
  const dtoDir = path.join(targetDir, 'dto')
  await ensureDir(dtoDir)
  const capitalizedName = toPascalCase(name)

  const createDtoCode = `import { tex } from 'exisjs/validator'\n\nexport const Create${capitalizedName}Dto = tex.object({\n  name: tex.string()\n})\n`
  await fs.writeFile(path.join(dtoDir, `create-${name}.dto.ts`), createDtoCode)

  await generateGateway(name, cwd, options)
  await generateService(name, cwd, options)

  const routeCode = options.oop
    ? `import { Controller, Get, Post, Body } from 'exisjs/decorators'\nimport { ${capitalizedName}Service } from './service'\nimport { Create${capitalizedName}Dto } from './dto/create-${name}.dto'\n\n@Controller()\nexport default class ${capitalizedName}Controller {\n  constructor(private readonly service: ${capitalizedName}Service) {}\n\n  @Get('/')\n  async list() {\n    const result = await this.service.list()\n    return { success: true, data: result }\n  }\n}\n`
    : `import { controller, route } from 'exisjs/router'\nimport * as service from './service'\nimport { Create${capitalizedName}Dto } from './dto/create-${name}.dto'\n\nexport default controller({\n  list: route.get('/', {\n    handle: async () => {\n      const data = await service.get${capitalizedName}s()\n      return { success: true, data }\n    }\n  })\n})\n`

  await fs.writeFile(path.join(targetDir, 'route.ts'), routeCode)
  success(
    `Generated ${options.oop ? 'OOP' : 'Functional'} resource in src/http/${name}/`
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
// import { ${capitalizedName} } from '../src/models/${capitalizedName}'

describe('${capitalizedName} Native Tests', () => {
  // Automatically boot the framework, inject dependencies, and cleanup on exit
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
