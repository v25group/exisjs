import fs from 'node:fs'
import path from 'node:path'
import {
  test as it,
  describe,
  expect,
  ex,
  beforeAll,
  afterAll,
  beforeEach,
} from '../../exisjs/src/testing'
import Module from 'node:module'

const mockModules: Record<string, any> = {
  'node:child_process': {
    exec: ex.fn((cmd: string, optionsOrCallback: any, cb: any) => {
      const callback =
        typeof optionsOrCallback === 'function' ? optionsOrCallback : cb
      if (callback) callback(null, { stdout: '', stderr: '' })
    }),
    spawnSync: ex.fn(() => ({ status: 0 })),
  },
}

const originalLoad = (Module as any)._load
;(Module as any)._load = function (...args: any[]) {
  const request = args[0]
  if (mockModules[request]) {
    return mockModules[request]
  }
  return originalLoad.apply(this, args)
}

describe('create-exis scaffolding', () => {
  let tmpDir: string
  let originalCwd: () => string
  let mockExit: any

  beforeAll(() => {
    tmpDir = path.join(__dirname, '.tmp-create-exis-' + Date.now())
    fs.mkdirSync(tmpDir, { recursive: true })
    originalCwd = process.cwd
    process.cwd = () => tmpDir

    mockExit = ex.spyOn(process, 'exit')
    mockExit.mockImplementation((code: number) => {
      throw new Error(`ProcessExited: ${code}`)
    })
  })

  afterAll(() => {
    process.cwd = originalCwd
    mockExit.mockRestore()
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
    // Restore loader
    ;(Module as any)._load = originalLoad
  })

  beforeEach(() => {
    ex.clearAllMocks()
    process.argv = ['node', 'index.js', 'my-test-app', '-y']
  })

  it('scaffolds a new project with srcDir and eslint enabled', async () => {
    try {
      await import('../src/index')
    } catch (err: any) {
      if (err.message !== 'ProcessExited: 0') {
        console.error('IMPORT ERROR:', err)
        throw err
      }
    }

    // Give promises time to settle
    await new Promise((resolve) => setTimeout(resolve, 100))

    const targetDir = path.join(tmpDir, 'my-test-app')

    expect(fs.existsSync(targetDir)).toBe(true)
    expect(fs.existsSync(path.join(targetDir, 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(targetDir, 'exis.config.ts'))).toBe(true)
    expect(
      fs.existsSync(path.join(targetDir, 'src', 'http', 'server.ts'))
    ).toBe(true)
    expect(
      fs.existsSync(path.join(targetDir, 'src', 'http', 'boundary.ts'))
    ).toBe(true)
    expect(
      fs.existsSync(path.join(targetDir, 'src', 'http', 'health', 'route.ts'))
    ).toBe(true)

    // Check package.json contents
    const pkg = JSON.parse(
      fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8')
    )
    expect(pkg.name).toBe('my-test-app')

    // Check .gitignore contains all critical ignore entries
    const gitignore = fs.readFileSync(
      path.join(targetDir, '.gitignore'),
      'utf-8'
    )
    expect(gitignore.includes('.exis/')).toBe(true)
    expect(gitignore.includes('dist/')).toBe(true)
    expect(gitignore.includes('.env')).toBe(true)
    expect(gitignore.includes('node_modules/')).toBe(true)
    expect(gitignore.includes('.DS_Store')).toBe(true)
    expect(gitignore.includes('Thumbs.db')).toBe(true)
  })

  it('validates template generators for both OOP and functional paradigms', async () => {
    const templates = await import('../src/templates')

    // 1. package.json template
    const pkgJson = JSON.parse(
      templates.packageJsonTemplate('test-api', true, true)
    )
    expect(pkgJson.name).toBe('test-api')
    expect(pkgJson.dependencies.exisjs).toBe('^0.7.13')
    expect(pkgJson.devDependencies.typescript).toBeDefined()
    expect(pkgJson.devDependencies.eslint).toBeDefined()

    // 2. tsconfig template
    const tsconfig = JSON.parse(templates.tsconfigTemplate('@/*'))
    expect(tsconfig.compilerOptions.experimentalDecorators).toBe(true)
    expect(tsconfig.compilerOptions.emitDecoratorMetadata).toBe(true)

    // 3. exis.config template
    const configTs = templates.exisConfigTemplate(true)
    expect(configTs.includes('asyncContext: true')).toBe(true)
    expect(configTs.includes('compression: true')).toBe(true)

    // 4. env.ts template with tex.env
    const envTs = templates.envTsTemplate(true)
    expect(envTs.includes('tex.env(')).toBe(true)
    expect(envTs.includes('PORT: tex.number(')).toBe(true)

    // 5. Server templates (OOP vs Functional)
    const oopServer = templates.serverTemplate('oop', true)
    expect(oopServer.includes('@Server()')).toBe(true)
    expect(oopServer.includes('export default class RootServer')).toBe(true)

    const funcServer = templates.serverTemplate('functional', true)
    expect(funcServer.includes('export default exis({')).toBe(true)

    // 6. Schema template with tex
    const schemaTs = templates.userSchemaTemplate(true)
    expect(schemaTs.includes('tex.object(')).toBe(true)
    expect(schemaTs.includes('tex.email()')).toBe(true)
    expect(schemaTs.includes('ResolveSchema<typeof createUserSchema>')).toBe(
      true
    )

    // 7. Service templates (OOP with @Injectable vs Functional)
    const oopService = templates.userServiceTemplate('oop', true)
    expect(oopService.includes("@Injectable({ scope: 'singleton' })")).toBe(
      true
    )
    expect(oopService.includes('export class UserService')).toBe(true)

    const funcService = templates.userServiceTemplate('functional', true)
    expect(funcService.includes('export async function createUser')).toBe(true)

    // 8. Route templates (OOP @Controller with constructor injection vs Functional controller())
    const oopRoute = templates.userRouteTemplate('oop', true)
    expect(oopRoute.includes('@Controller()')).toBe(true)
    expect(
      oopRoute.includes(
        'constructor(private readonly userService: UserService)'
      )
    ).toBe(true)
    expect(oopRoute.includes("@Get('/')")).toBe(true)
    expect(oopRoute.includes("@Post('/', { body: createUserSchema })")).toBe(
      true
    )

    const funcRoute = templates.userRouteTemplate('functional', true)
    expect(funcRoute.includes('export default controller({')).toBe(true)
    expect(funcRoute.includes("createUser: route.post('/', {")).toBe(true)

    // 9. Cron templates (OOP @Cron vs Functional cron())
    const oopCron = templates.exampleCronTemplate('oop', true)
    expect(oopCron.includes('@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT')).toBe(
      true
    )

    const funcCron = templates.exampleCronTemplate('functional', true)
    expect(funcCron.includes('export default cron({')).toBe(true)

    // 10. Boundary templates (OOP @Boundary vs Functional defineBoundary)
    const oopBoundary = templates.rootBoundaryTemplate('oop')
    expect(oopBoundary.includes('@Boundary(')).toBe(true)

    const funcBoundary = templates.rootBoundaryTemplate('functional')
    expect(funcBoundary.includes('export const config = defineBoundary(')).toBe(
      true
    )
  })
})
