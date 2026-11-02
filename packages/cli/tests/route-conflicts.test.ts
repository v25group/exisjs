import fs from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
} from '../../exisjs/src/testing'
import { createTempDir, cleanupTempDir } from '../../exisjs/tests/helpers'

const execAsync = promisify(exec)

const cliPath = path.resolve(__dirname, '../dist/index.js')
const dist = path.resolve(__dirname, '../../exisjs/dist').replace(/\\/g, '/')

const routeFile = (routePath: string) => `
import { controller, route } from '${dist}/router/index.js'
export default controller({
  main: route.get('${routePath}', { handle: () => 'ok' }),
})
`

describe('route conflicts in the CLI', () => {
  let root: string

  const write = (relative: string, source: string) => {
    const file = path.join(root, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, source)
  }

  const run = async (args: string) => {
    try {
      const { stdout, stderr } = await execAsync(`node "${cliPath}" ${args}`, {
        cwd: root,
      })
      return { code: 0, stdout, stderr }
    } catch (err: any) {
      return { code: err.code, stdout: err.stdout, stderr: err.stderr }
    }
  }

  beforeEach(() => {
    root = createTempDir('exis-cli-conflicts-')
    write(
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: { outDir: 'dist', skipLibCheck: true },
      })
    )
    write(
      'src/http/server.ts',
      `import { defineApp } from '${dist}/server/define.js'
export default defineApp({ port: 3000 })
`
    )
  })

  afterEach(() => {
    cleanupTempDir(root)
  })

  it('routes names both files instead of printing a doubled row', async () => {
    write('src/http/health/health.route.ts', routeFile('/'))
    write('src/http/health/extra.route.ts', routeFile('/'))

    const { code, stdout, stderr } = await run('routes --json')

    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('health.route.ts')
    expect(stderr).toContain('extra.route.ts')
  })

  it('routes reports the same path from two folders', async () => {
    write('src/http/a/a.route.ts', routeFile('/shared'))
    write('src/http/a/shared/shared.route.ts', routeFile('/'))

    const { code, stderr } = await run('routes')

    expect(code).toBe(1)
    expect(stderr).toContain('a.route.ts')
    expect(stderr).toContain('shared.route.ts')
  })

  it('routes leaves out a file that only ends in route', async () => {
    write('src/http/x/reroute.ts', routeFile('/'))
    write('src/http/y/y.route.ts', routeFile('/'))

    const { code, stdout } = await run('routes --json')

    expect(code).toBe(0)
    const paths = JSON.parse(stdout).map((r: { path: string }) => r.path)
    expect(paths.some((p: string) => p.startsWith('/y'))).toBe(true)
    expect(paths.some((p: string) => p.startsWith('/x'))).toBe(false)
  })

  it('build fails on two route files in one folder', async () => {
    write('src/http/health/health.route.ts', routeFile('/'))
    write('src/http/health/extra.route.ts', routeFile('/'))

    const { code, stdout, stderr } = await run('build --skip-env-check')

    expect(code).toBe(1)
    expect(stdout + stderr).toContain('A folder can only hold one route file')
    expect(fs.existsSync(path.join(root, '.exis', 'routes-manifest.js'))).toBe(
      false
    )
  })

  it('doctor fails on two boundaries and warns on a near-miss name', async () => {
    write('src/http/a/a.route.ts', routeFile('/'))
    write('src/http/a/reroute.ts', 'export const x = 1')
    write('src/http/a/boundary.ts', 'export const config = {}')
    write('src/http/a/admin.boundary.ts', 'export const config = {}')

    const { stdout, stderr } = await run('doctor')
    const output = stdout + stderr

    expect(output).toContain('A folder can only hold one boundary file')
    expect(output).toContain('reroute.ts')
  })
})
