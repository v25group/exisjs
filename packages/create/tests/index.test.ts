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
} from 'exisjs/testing'
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
    expect(fs.existsSync(path.join(targetDir, 'src/http/server.ts'))).toBe(true)
    expect(
      fs.existsSync(path.join(targetDir, 'src/http/health/route.ts'))
    ).toBe(true)

    // Check package.json contents
    const pkg = JSON.parse(
      fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8')
    )
    expect(pkg.name).toBe('my-test-app')
  })
})
