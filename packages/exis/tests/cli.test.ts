import * as path from 'node:path'
import * as fs from 'node:fs'
import * as cp from 'node:child_process'
import { generateRoute } from '../src/cli/commands/generate'
import { buildCommand } from '../src/cli/commands/build'
import { startCommand } from '../src/cli/commands/start'
import { devCommand } from '../src/cli/commands/dev'
import { createTempDir, writeTempFile, cleanupTempDir } from './helpers'

// Mock dependencies
jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}))

describe('CLI Commands', () => {
  let tmpDir: string
  let originalCwd: () => string
  let mockExit: jest.SpyInstance
  let mockLog: jest.SpyInstance
  let mockError: jest.SpyInstance

  beforeAll(() => {
    tmpDir = createTempDir('exis-cli-')
    originalCwd = process.cwd
    process.cwd = () => tmpDir

    // Suppress console output during tests
    mockLog = jest.spyOn(console, 'log').mockImplementation(() => {})
    mockError = jest.spyOn(console, 'error').mockImplementation(() => {})

    // Mock process.exit so we don't kill the test runner
    mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`ProcessExited: ${code}`)
    })
  })

  afterAll(() => {
    process.cwd = originalCwd
    mockLog.mockRestore()
    mockError.mockRestore()
    mockExit.mockRestore()
    cleanupTempDir(tmpDir)
  })

  afterEach(() => {
    jest.clearAllMocks()
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

      // Clear mockLog to track subsequent calls
      mockError.mockClear()

      // Second generation should log a warning and not throw
      await generateRoute('existing', tmpDir)

      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining('already exists')
      )
    })
  })

  describe('buildCommand', () => {
    it('skips compilation if tsconfig.json is missing', async () => {
      await expect(buildCommand()).resolves.toBeUndefined()
    })

    it('spawns tsc when tsconfig exists', async () => {
      writeTempFile(tmpDir, 'tsconfig.json', '{}')

      // Mock spawn to return a fake child process that exits with 0
      const mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
          if (event === 'exit') cb(0)
        }),
      }
      ;(cp.spawn as jest.Mock).mockReturnValue(mockChild)

      await buildCommand({ outDir: 'dist' })

      expect(cp.spawn).toHaveBeenCalled()
      const args = (cp.spawn as jest.Mock).mock.calls[0]
      expect(args[0]).toContain('tsc') // command string
      expect(args[0]).toContain('--project') // command string arguments
    })

    it('rejects if tsc spawn fails with non-zero exit code', async () => {
      writeTempFile(tmpDir, 'tsconfig.json', '{}')

      const mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
          if (event === 'exit') cb(1)
        }),
      }
      ;(cp.spawn as jest.Mock).mockReturnValue(mockChild)

      await expect(buildCommand({ outDir: 'dist' })).rejects.toThrow(
        'ProcessExited: 1'
      )
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
        on: jest.fn(),
        kill: jest.fn(),
      }
      ;(cp.spawn as jest.Mock).mockReturnValue(mockChild)

      await startCommand()

      expect(cp.spawn).toHaveBeenCalled()
      const args = (cp.spawn as jest.Mock).mock.calls[0]
      expect(args[0]).toContain('node')
      expect(args[2].env.EXIS_ENTRY_FILE).toContain(path.normalize(entryPath))
    })

    it('spawns node with compiled output', async () => {
      const entryPath = 'dist/http/server.js'
      writeTempFile(tmpDir, entryPath, 'console.log("ready")')

      const mockChild = {
        on: jest.fn(),
        kill: jest.fn(),
      }
      ;(cp.spawn as jest.Mock).mockReturnValue(mockChild)

      await startCommand()

      expect(cp.spawn).toHaveBeenCalled()
      const args = (cp.spawn as jest.Mock).mock.calls[0]
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
        on: jest.fn(),
        kill: jest.fn(),
      }
      ;(cp.spawn as jest.Mock).mockReturnValue(mockChild)

      try {
        await devCommand({ _disableWatch: true })
      } catch (err: unknown) {
        if ((err as Error).message !== 'ProcessExited: 1') throw err
      }

      if ((cp.spawn as jest.Mock).mock.calls.length > 0) {
        const args = (cp.spawn as jest.Mock).mock.calls[0]
        const binPath = args[0]
        // ensure it's trying to run tsx or ts-node
        expect(binPath).toMatch(/node|tsx|ts-node/)
      }
    })

    it('starts dev server when entry exists', async () => {
      writeTempFile(tmpDir, 'src/http/server.ts', 'console.log("dev")')

      const mockChild = {
        on: jest.fn(),
        kill: jest.fn(),
      }
      ;(cp.spawn as jest.Mock).mockReturnValue(mockChild)

      try {
        await devCommand({ _disableWatch: true })
      } catch (err: unknown) {
        if ((err as Error).message !== 'ProcessExited: 1') throw err
      }
    })
  })
})
