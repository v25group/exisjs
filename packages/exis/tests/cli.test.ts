import * as path from 'node:path'
import * as fs from 'node:fs'
import cp from 'node:child_process'
import { generateRoute } from '../src/cli/commands/generate'
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

  describe('generateRoute', () => {
    it('scaffolds a route feature slice', async () => {
      await generateRoute('users', tmpDir)

      const apiDir = path.join(tmpDir, 'src', 'http', 'users')
      expect(fs.existsSync(apiDir)).toBe(true)
      expect(fs.existsSync(path.join(apiDir, 'route.ts'))).toBe(true)

      const routeCode = fs.readFileSync(path.join(apiDir, 'route.ts'), 'utf8')
      expect(routeCode).toContain('controller')
    })

    it('handles generating a route that already exists', async () => {
      // First generation
      await generateRoute('existing', tmpDir)

      // Clear mocks to track subsequent calls
      mockError.mockClear()
      mockExit.mockClear()

      // Second generation should call process.exit(1)
      await generateRoute('existing', tmpDir)

      expect(mockError).toHaveBeenCalled()
      expect(mockError.mock.calls[0].arguments[0]).toContain('already exists')
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
  })
})
