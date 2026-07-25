import fs from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'

jest.mock('node:child_process', () => ({
  exec: jest.fn((cmd, optionsOrCallback, cb) => {
    const callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : cb
    if (callback) callback(null, { stdout: '', stderr: '' })
  }),
  spawnSync: jest.fn(() => ({ status: 0 })),
}))

jest.mock('prompts', () => {
  return jest.fn().mockResolvedValue({
    typescript: true,
    eslint: true,
    srcDir: true,
    customAlias: false,
    alias: '@/*',
  })
})

jest.mock(
  'ora',
  () => {
    return jest.fn().mockReturnValue({
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
    })
  },
  { virtual: true }
)

describe('create-exis scaffolding', () => {
  let tmpDir: string
  let originalCwd: () => string
  let mockExit: jest.SpyInstance
  let mockLog: jest.SpyInstance
  let mockError: jest.SpyInstance

  beforeAll(() => {
    tmpDir = path.join(__dirname, '.tmp-create-exis-' + Date.now())
    fs.mkdirSync(tmpDir, { recursive: true })
    originalCwd = process.cwd
    process.cwd = () => tmpDir

    mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      // Just record the call
      return undefined as never
    })
  })

  afterAll(() => {
    process.cwd = originalCwd
    mockExit.mockRestore()
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
    process.argv = ['node', 'index.js', 'my-test-app']
  })

  it('scaffolds a new project with srcDir and eslint enabled', async () => {
    try {
      await import('../src/index')
    } catch (err) {
      console.error('IMPORT ERROR:', err)
      throw err
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
