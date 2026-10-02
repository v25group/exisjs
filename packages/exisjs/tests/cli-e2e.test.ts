import fs from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it, beforeAll, afterAll } from '../src/testing'
import { createTempDir, cleanupTempDir } from './helpers'
const execAsync = promisify(exec)

describe('Exis CLI E2E', () => {
  let tmpDir: string
  const cliPath = path.resolve(__dirname, '../dist/cli/index.js')

  beforeAll(() => {
    tmpDir = createTempDir('exis-cli-e2e-')

    // Create a dummy tsconfig to prevent buildCommand from failing immediately
    fs.writeFileSync(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          outDir: 'dist',
          skipLibCheck: true,
          paths: {
            'exisjs/router': [
              path
                .resolve(__dirname, '../dist/router/index')
                .replace(/\\/g, '/'),
            ],
            'exisjs/*': [
              path.resolve(__dirname, '../dist/*').replace(/\\/g, '/'),
              path.resolve(__dirname, '../dist/*/index').replace(/\\/g, '/'),
            ],
            exisjs: [
              path.resolve(__dirname, '../dist/index').replace(/\\/g, '/'),
            ],
          },
        },
      })
    )
  })

  afterAll(() => {
    cleanupTempDir(tmpDir)
  })

  it('prints help message when run with --help', async () => {
    const { stdout } = await execAsync(`node "${cliPath}" --help`, {
      cwd: tmpDir,
    })
    expect(stdout).toContain('Usage: exisjs|exis [options] [command]')
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
      'Generated Functional route in src/http/e2eTest/route.ts'
    )

    const apiDir = path.join(tmpDir, 'src', 'http', 'e2eTest')
    expect(fs.existsSync(apiDir)).toBe(true)

    const routeFile = path.join(apiDir, 'route.ts')
    expect(fs.existsSync(routeFile)).toBe(true)

    const content = fs.readFileSync(routeFile, 'utf-8')
    expect(content).toContain('controller')
  })

  it('inspects routes from TypeScript entry file using exisjs routes', async () => {
    // Create a minimal TypeScript server entry file in tmpDir
    const httpDir = path.join(tmpDir, 'src', 'http')
    fs.mkdirSync(httpDir, { recursive: true })

    const serverFile = path.join(httpDir, 'server.ts')
    fs.writeFileSync(
      serverFile,
      `import { defineApp } from '${path.resolve(__dirname, '../dist/server/define.js').replace(/\\/g, '/')}'
export default defineApp({
  port: 3000
})
`,
      'utf-8'
    )

    const { stdout } = await execAsync(`node "${cliPath}" routes --json`, {
      cwd: tmpDir,
    })

    const parsed = JSON.parse(stdout)
    expect(Array.isArray(parsed)).toBe(true)
  })

  it('generates production manifest with dedicated src/cron directory', async () => {
    // Create a dedicated src/cron/cleanup.ts
    const cronDir = path.join(tmpDir, 'src', 'cron')
    fs.mkdirSync(cronDir, { recursive: true })

    const cronFile = path.join(cronDir, 'cleanup.ts')
    fs.writeFileSync(
      cronFile,
      `export const job = { name: 'cleanup', cron: '* * * * *', run: () => {} }`,
      'utf-8'
    )

    // Build the project in tmpDir
    const { stdout } = await execAsync(
      `node "${cliPath}" build --skip-env-check`,
      {
        cwd: tmpDir,
      }
    )

    expect(stdout).toContain('compiled via esbuild')

    const manifestFile = path.join(tmpDir, '.exis', 'routes-manifest.js')
    expect(fs.existsSync(manifestFile)).toBe(true)

    const manifestContent = fs.readFileSync(manifestFile, 'utf-8')
    expect(manifestContent).toContain('cronJobs = [')
    expect(manifestContent).toContain('cron_0')
    expect(manifestContent).toContain('cleanup.js')
  })
})
