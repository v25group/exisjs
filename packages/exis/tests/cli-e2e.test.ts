import fs from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it, ex, beforeAll, afterAll } from '../src/testing'
const execAsync = promisify(exec)

describe('Exis CLI E2E', () => {
  let tmpDir: string
  const cliPath = path.resolve(__dirname, '../dist/cli/index.js')

  beforeAll(() => {
    tmpDir = path.join(__dirname, '.tmp-exis-cli-e2e-' + Date.now())
    fs.mkdirSync(tmpDir, { recursive: true })

    // Create a dummy tsconfig to prevent buildCommand from failing immediately
    fs.writeFileSync(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { outDir: 'dist' } })
    )
  })

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('prints help message when run with --help', async () => {
    const { stdout } = await execAsync(`node "${cliPath}" --help`, {
      cwd: tmpDir,
    })
    expect(stdout).toContain('Usage: exis [options] [command]')
    expect(stdout).toContain('dev')
    expect(stdout).toContain('build')
    expect(stdout).toContain('start')
  })

  it('prints error and exits with non-zero when run with unknown command', async () => {
    try {
      await execAsync(`node "${cliPath}" unknown-command`, { cwd: tmpDir })
      expect.fail('Should have thrown an error')
    } catch (err: any) {
      expect(err.code).not.toBe(0)
      expect(err.stderr).toContain("error: unknown command 'unknown-command'")
    }
  })

  it('scaffolds a route via generate command e2e', async () => {
    const { stdout } = await execAsync(
      `node "${cliPath}" generate route e2eTest`,
      { cwd: tmpDir }
    )

    expect(stdout).toContain(
      'Generated e2eTest MVC structure in src/http/e2eTest/'
    )

    const apiDir = path.join(tmpDir, 'src', 'http', 'e2eTest')
    expect(fs.existsSync(apiDir)).toBe(true)

    const routeFile = path.join(apiDir, 'route.ts')
    expect(fs.existsSync(routeFile)).toBe(true)

    const content = fs.readFileSync(routeFile, 'utf-8')
    expect(content).toContain('controller')
  })
})
