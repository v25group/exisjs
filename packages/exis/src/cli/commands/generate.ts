import fs from 'node:fs/promises'
import path from 'node:path'
import { success, error as logError } from '../utils'

export async function generateRoute(name: string, cwd = process.cwd()) {
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

  const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1)

  const schemaCode = `import { v } from 'exisjs/validator'

export const Create${capitalizedName}Schema = v.object({
  name: v.string()
})
`

  const serviceCode = `export async function create${capitalizedName}(data: { name: string }) {
  // Add your database logic here
  return { id: Date.now(), name: data.name, created: true }
}

export async function get${capitalizedName}s() {
  return [{ id: 1, name: 'Sample ${capitalizedName}' }]
}
`

  const controllerCode = `import * as service from './service'

export async function create({ body }: any) {
  const result = await service.create${capitalizedName}(body)
  return { success: true, data: result }
}

export async function list() {
  const result = await service.get${capitalizedName}s()
  return { success: true, data: result }
}
`

  const routeCode = `import { controller, route } from 'exisjs/router'
import * as handler from './controller'
import * as schema from './schema'

export default controller({
  list: route.get('/', {
    handle: handler.list
  }),
  create: route.post('/', {
    body: schema.Create${capitalizedName}Schema,
    handle: handler.create
  })
})
`

  await fs.writeFile(path.join(targetDir, 'schema.ts'), schemaCode)
  await fs.writeFile(path.join(targetDir, 'service.ts'), serviceCode)
  await fs.writeFile(path.join(targetDir, 'controller.ts'), controllerCode)
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
