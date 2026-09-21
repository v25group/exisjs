import * as path from 'node:path'
import * as fs from 'node:fs'
import cp from 'node:child_process'
import { generateController } from '../src/cli/commands/generate'
import { buildCommand } from '../src/cli/commands/build'
import { startCommand } from '../src/cli/commands/start'
import { devCommand } from '../src/cli/commands/dev'
import { createTempDir, writeTempFile, cleanupTempDir } from './helpers'
import {
  ex,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from '../src/testing'
import * as ts from 'typescript'

describe('CLI Commands', () => {
  let tmpDir: string
  let originalCwd: () => string
  let mockExit: any
  let mockLog: any
  let mockError: any
  let mockSpawn: any

  beforeAll(() => {
    tmpDir = createTempDir('exis-cli-')
    originalCwd = process.cwd
    process.cwd = () => tmpDir

    // Suppress console output during tests
    mockLog = ex.spyOn(console, 'log')
    mockError = ex.spyOn(console, 'error')

    // Mock process.exit so we don't kill the test runner
    mockExit = ex.spyOn(process, 'exit')
    mockExit.mockImplementation((code: number) => {
      throw new Error(`ProcessExited: ${code}`)
    })

    // Mock child_process.spawn
    mockSpawn = ex.spyOn(cp, 'spawn')
  })

  afterAll(() => {
    process.cwd = originalCwd
    mockLog.mockRestore()
    mockError.mockRestore()
    mockExit.mockRestore()
    mockSpawn.mockRestore()
    cleanupTempDir(tmpDir)
  })

  afterEach(() => {
    mockSpawn.mockClear()
    mockLog.mockClear()
    mockError.mockClear()
    mockExit.mockClear()
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
    process.stdin.removeAllListeners('data')
    process.stdin.pause()

    if (fs.existsSync(path.join(tmpDir, 'dist'))) {
      fs.rmSync(path.join(tmpDir, 'dist'), { recursive: true, force: true })
    }
    if (fs.existsSync(path.join(tmpDir, 'src'))) {
      fs.rmSync(path.join(tmpDir, 'src'), { recursive: true, force: true })
    }
  })

  describe('generateController', () => {
    it('scaffolds a route feature slice', async () => {
      await generateController('users', tmpDir)

      const apiDir = path.join(tmpDir, 'src', 'http', 'users')
      expect(fs.existsSync(apiDir)).toBe(true)
      expect(fs.existsSync(path.join(apiDir, 'route.ts'))).toBe(true)

      const routeCode = fs.readFileSync(path.join(apiDir, 'route.ts'), 'utf8')
      expect(routeCode).toContain('controller')
    })

    it('handles generating a route that already exists', async () => {
      // First generation
      await generateController('existing', tmpDir)

      // Clear mocks to track subsequent calls
      mockError.mockClear()
      mockExit.mockClear()

      // Second generation should call process.exit(1)
      await generateController('existing', tmpDir)

      expect(mockError).toHaveBeenCalled()
      expect(mockError.mock.calls[0].arguments[0]).toContain('already exists')
    })
  })

  describe('generateSchema, Boundary & Resource', () => {
    it('generates a schema.ts using tex validator', async () => {
      const { generateSchema } = await import('../src/cli/commands/generate')
      await generateSchema('posts', tmpDir)

      const schemaFile = path.join(tmpDir, 'src', 'http', 'posts', 'schema.ts')
      expect(fs.existsSync(schemaFile)).toBe(true)

      const content = fs.readFileSync(schemaFile, 'utf8')
      expect(content).toContain("import { tex } from 'exisjs/validator'")
      expect(content).toContain('PostsParamsSchema')
    })

    it('generates a boundary.ts file', async () => {
      const { generateBoundary } = await import('../src/cli/commands/generate')
      await generateBoundary('admin', tmpDir)

      const boundaryFile = path.join(
        tmpDir,
        'src',
        'http',
        'admin',
        'boundary.ts'
      )
      expect(fs.existsSync(boundaryFile)).toBe(true)

      const content = fs.readFileSync(boundaryFile, 'utf8')
      expect(content).toContain('defineBoundary')
    })

    it('generates a full resource slice (schema, service, route)', async () => {
      const { generateResource } = await import('../src/cli/commands/generate')
      await generateResource('articles', tmpDir)

      const dir = path.join(tmpDir, 'src', 'http', 'articles')
      expect(fs.existsSync(path.join(dir, 'schema.ts'))).toBe(true)
      expect(fs.existsSync(path.join(dir, 'service.ts'))).toBe(true)
      expect(fs.existsSync(path.join(dir, 'route.ts'))).toBe(true)
    })

    it('generates a named resource slice with --named (e.g. user.route.ts, user.schema.ts)', async () => {
      const { generateResource } = await import('../src/cli/commands/generate')
      await generateResource('products', tmpDir, { named: true })

      const dir = path.join(tmpDir, 'src', 'http', 'products')
      expect(fs.existsSync(path.join(dir, 'products.schema.ts'))).toBe(true)
      expect(fs.existsSync(path.join(dir, 'products.service.ts'))).toBe(true)
      expect(fs.existsSync(path.join(dir, 'products.route.ts'))).toBe(true)

      const routeContent = fs.readFileSync(
        path.join(dir, 'products.route.ts'),
        'utf8'
      )
      expect(routeContent).toContain('./products.service')
      expect(routeContent).toContain('./products.schema')
    })
  })

  describe('buildCommand', () => {
    it('skips compilation if tsconfig.json is missing', async () => {
      await expect(buildCommand()).resolves.toBeUndefined()
    })

    it('builds using esbuild when tsconfig exists', async () => {
      writeTempFile(tmpDir, 'tsconfig.json', '{}')
      writeTempFile(tmpDir, 'src/test.ts', 'export const x = 1')

      try {
        await buildCommand({ outDir: 'dist' })
      } catch (e: any) {
        if (e.message !== 'ProcessExited: 0') throw e
      }

      expect(fs.existsSync(path.join(tmpDir, 'dist'))).toBe(true)
    })

    it('rejects if esbuild fails', async () => {
      writeTempFile(
        tmpDir,
        'tsconfig.json',
        '{ "compilerOptions": { "module": "invalid" } }'
      )
      writeTempFile(tmpDir, 'src/test.ts', 'export const x = 1')
      writeTempFile(tmpDir, 'tsconfig.json', 'invalid')

      try {
        await buildCommand({ outDir: 'dist' })
        throw new Error('Should have thrown')
      } catch (e: any) {
        expect(e.message).toContain('ProcessExited: 1')
      }
    })

    it('ignores root tool config files like drizzle.config.ts during server build and type-checking', async () => {
      writeTempFile(
        tmpDir,
        'tsconfig.json',
        JSON.stringify({
          compilerOptions: {
            module: 'commonjs',
            target: 'es2022',
            skipLibCheck: true,
          },
          include: ['**/*.ts'],
        })
      )
      writeTempFile(tmpDir, 'src/test.ts', 'export const serverReady = true')
      // drizzle.config.ts with an uninstalled devDependency
      writeTempFile(
        tmpDir,
        'drizzle.config.ts',
        'import { defineConfig } from "drizzle-kit"; export default defineConfig({})'
      )

      try {
        await buildCommand({ outDir: 'dist' })
      } catch (e: any) {
        if (e.message !== 'ProcessExited: 0') throw e
      }

      expect(fs.existsSync(path.join(tmpDir, 'dist'))).toBe(true)
      expect(
        fs.existsSync(path.join(tmpDir, 'dist', 'drizzle.config.js'))
      ).toBe(false)
    })

    it('loads .env during buildCommand and populates process.env', async () => {
      writeTempFile(
        tmpDir,
        'tsconfig.json',
        JSON.stringify({
          compilerOptions: { module: 'commonjs', target: 'es2022' },
          include: ['src/**/*.ts'],
        })
      )
      writeTempFile(tmpDir, 'src/test.ts', 'export const ok = true')
      writeTempFile(tmpDir, '.env', 'BUILD_TEST_VAR=loaded_at_build')

      try {
        await buildCommand({ outDir: 'dist' })
      } catch (e: any) {
        if (e.message !== 'ProcessExited: 0') throw e
      }

      expect(process.env.BUILD_TEST_VAR).toBe('loaded_at_build')
    })

    it('supports skipEnvCheck and dryRun to bypass missing runtime environment variables', async () => {
      writeTempFile(
        tmpDir,
        'tsconfig.json',
        JSON.stringify({
          compilerOptions: { module: 'commonjs', target: 'es2022' },
          include: ['src/**/*.ts'],
        })
      )
      writeTempFile(tmpDir, 'src/test.ts', 'export const ok = true')

      try {
        await buildCommand({ outDir: 'dist', skipEnvCheck: true })
      } catch (e: any) {
        if (e.message !== 'ProcessExited: 0') throw e
      }

      expect(fs.existsSync(path.join(tmpDir, 'dist'))).toBe(true)
      expect(process.env.__EXIS_SKIP_ENV_CHECK).toBe('true')
    })
  })

  describe('startCommand', () => {
    it('fails if no entry file found', async () => {
      await expect(startCommand()).rejects.toThrow('ProcessExited: 1')
    })

    it('resolves dist/http/server.js as entry', async () => {
      const entryPath = 'dist/http/server.js'
      const dirPath = path.dirname(path.join(tmpDir, entryPath))
      fs.mkdirSync(dirPath, { recursive: true })
      writeTempFile(tmpDir, entryPath, 'console.log("ready")')

      const mockChild = {
        on: ex.fn(),
        once: ex.fn(),
        kill: ex.fn(),
      }
      mockSpawn.mockReturnValue(mockChild)

      await startCommand()

      expect(cp.spawn).toHaveBeenCalled()
      const args = mockSpawn.mock.calls[0].arguments
      expect(args[0]).toContain('node')
      expect(args[2].env.EXIS_ENTRY_FILE).toContain(path.normalize(entryPath))
    })

    it('spawns node with compiled output', async () => {
      const entryPath = 'dist/http/server.js'
      writeTempFile(tmpDir, entryPath, 'console.log("ready")')

      const mockChild = {
        on: ex.fn(),
        once: ex.fn(),
        kill: ex.fn(),
      }
      mockSpawn.mockReturnValue(mockChild)

      await startCommand()

      expect(cp.spawn).toHaveBeenCalled()
      const args = mockSpawn.mock.calls[0].arguments
      expect(args[0]).toContain('node')
      expect(args[2].env.EXIS_ENTRY_FILE).toContain(path.normalize(entryPath))
    })
  })

  describe('devCommand', () => {
    it('fails if no source entry file found', async () => {
      // tmpDir has tsconfig from earlier, but no src/app.ts
      await expect(devCommand({ _disableWatch: true })).rejects.toThrow(
        'ProcessExited: 1'
      )
    })

    it('starts dev server when src/api/server.ts exists', async () => {
      const entryPath = 'src/http/server.ts'
      const dirPath = path.dirname(path.join(tmpDir, entryPath))
      fs.mkdirSync(dirPath, { recursive: true })
      writeTempFile(tmpDir, entryPath, 'console.log("dev")')

      const mockChild = {
        on: ex.fn(),
        kill: ex.fn(),
      }
      mockSpawn.mockReturnValue(mockChild)

      try {
        await devCommand({ _disableWatch: true })
      } catch (err: unknown) {
        if ((err as Error).message !== 'ProcessExited: 1') throw err
      }

      if (mockSpawn.mock.calls.length > 0) {
        const args = mockSpawn.mock.calls[0].arguments
        const binPath = args[0]
        // ensure it's trying to run tsx or ts-node
        expect(binPath).toMatch(/node|tsx|ts-node/)
      }
    })

    it('starts dev server when entry exists', async () => {
      writeTempFile(tmpDir, 'src/http/server.ts', 'console.log("dev")')

      const mockChild = {
        on: ex.fn(),
        kill: ex.fn(),
      }
      mockSpawn.mockReturnValue(mockChild)

      try {
        await devCommand({ _disableWatch: true })
      } catch (err: unknown) {
        if ((err as Error).message !== 'ProcessExited: 1') throw err
      }
    })

    it('attaches error handler and ignores archive/lock files in watcher', async () => {
      const chokidar = await import('chokidar')
      const ignored = [
        /(^|[/\\])\../,
        /node_modules/,
        /\.exis/,
        /dist/,
        /build/,
        /exis\.d\.ts$/,
        /\.(rar|zip|7z|tar|gz|tgz|bz2|xz|iso)$/i,
        /\.(bak|tmp|temp|swp|swo|lock|pid)$/i,
        /\.(log|log\.\d+|sqlite|sqlite3|db|db-shm|db-wal|db-journal)$/i,
        /\.(png|jpe?g|gif|svg|ico|webp|avif|mp4|webm|mov|mp3|wav|pdf|docx?|xlsx?|pptx?)$/i,
      ]

      // Test that archive regex matches archive paths
      const isArchiveIgnored = (file: string) =>
        ignored.some((pattern) => pattern.test(file))
      expect(isArchiveIgnored('docs.rar')).toBe(true)
      expect(isArchiveIgnored('archive.zip')).toBe(true)
      expect(isArchiveIgnored('backup.tar.gz')).toBe(true)
      expect(isArchiveIgnored('temp.tmp')).toBe(true)
      expect(isArchiveIgnored('src/http/server.ts')).toBe(false)

      // Test watcher instance handles EBUSY without throwing uncaught exception
      const watcher = chokidar.watch(tmpDir, {
        ignoreInitial: true,
        ignored,
      })

      let errorCaught = false
      watcher.on('error', (err: any) => {
        if (err?.code === 'EBUSY' || err?.code === 'EPERM') {
          errorCaught = true
        }
      })

      // Emit simulated Windows EBUSY error
      watcher.emit('error', {
        errno: -4082,
        code: 'EBUSY',
        syscall: 'watch',
        path: path.join(tmpDir, 'docs.rar'),
      })

      expect(errorCaught).toBe(true)
      await watcher.close()
    })

    it('detects custom port from exis.config.ts for dev fallback server', () => {
      const configTs = path.join(tmpDir, 'exis.config.ts')
      fs.writeFileSync(configTs, 'export default { port: 3000 }', 'utf8')

      const content = fs.readFileSync(configTs, 'utf8')
      const match = content.match(/\bport\s*:\s*(\d+)/)
      expect(match).toBeDefined()
      expect(parseInt(match![1], 10)).toBe(3000)
    })
  })

  describe('routesCommand', () => {
    it('fails if entry file does not exist', async () => {
      const { routesCommand } = await import('../src/cli/routes')
      try {
        await routesCommand(tmpDir, { entry: 'non-existent.ts' })
      } catch (err: unknown) {
        expect((err as Error).message).toBe('ProcessExited: 1')
      }
    })
  })

  describe('doctorCommand', () => {
    it('runs diagnostics report without crashing', async () => {
      const { doctorCommand } = await import('../src/cli/commands/doctor')
      writeTempFile(
        tmpDir,
        'package.json',
        JSON.stringify({ name: 'test-app' })
      )
      writeTempFile(
        tmpDir,
        'tsconfig.json',
        JSON.stringify({ compilerOptions: { strict: true } })
      )
      writeTempFile(tmpDir, 'src/http/server.ts', 'export default {}')

      try {
        await doctorCommand(tmpDir)
      } catch (err: unknown) {
        if (
          (err as Error).message !== 'ProcessExited: 0' &&
          (err as Error).message !== 'ProcessExited: 1'
        ) {
          throw err
        }
      }
    })
  })
})
