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

const routeFile = (options: string) => `
import { controller, route } from '${dist}/router/index.js'
export default controller({
  main: route.get('/', { ${options} handle: () => 'ok' }),
})
`

describe('exisjs routes --audit and doctor layout checks', () => {
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
    root = createTempDir('exis-cli-audit-')
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
    write('src/http/open/open.route.ts', routeFile('public: true,'))
    write(
      'src/http/leads/leads.route.ts',
      routeFile(`permissions: ['leads.read'],`)
    )
  })

  afterEach(() => {
    cleanupTempDir(root)
  })

  it('fails on an open route nobody reviewed, and names it', async () => {
    const { code, stderr } = await run('routes --audit')

    expect(code).toBe(1)
    expect(stderr).toContain('GET /open')
    expect(stderr).not.toContain('GET /leads')
  })

  it('passes once the route is on the list', async () => {
    write('routes-audit.json', '{ "open": ["GET /open"] }')

    const { code, stdout } = await run('routes --audit')

    expect(code).toBe(0)
    expect(stdout).toContain('routes-audit.json')
  })

  it('fails on an entry with no route', async () => {
    write('routes-audit.json', '{ "open": ["GET /open", "GET /removed"] }')

    const { code, stderr } = await run('routes --audit')

    expect(code).toBe(1)
    expect(stderr).toContain('GET /removed')
  })

  it('reports as JSON with --json', async () => {
    const { code, stdout } = await run('routes --audit --json')

    expect(code).toBe(1)
    expect(JSON.parse(stdout)).toEqual({
      unreviewed: ['GET /open'],
      stale: [],
    })
  })

  it('names the file when the list is broken', async () => {
    write('routes-audit.json', '{ nope')

    const { code, stderr } = await run('routes --audit')

    expect(code).toBe(1)
    expect(stderr).toContain('routes-audit.json')
  })

  it('doctor warns when domain code imports database or http', async () => {
    write(
      'src/domain/money.ts',
      `import { db } from '../database/db'\nexport const a = db`
    )
    write(
      'src/domain/alias.ts',
      `import { x } from '@/http/users/users.service'\nexport const b = x`
    )
    write(
      'src/domain/pure.ts',
      `import { sum } from './sum'\nimport http from 'node:http'\nexport const c = [sum, http]`
    )

    const { stdout } = await run('doctor')

    expect(stdout).toContain('src/domain/money.ts')
    expect(stdout).toContain('src/domain/alias.ts')
    expect(stdout).not.toContain('src/domain/pure.ts')
  })

  it('doctor warns on mixed route file names', async () => {
    write('src/http/plain/route.ts', routeFile('public: true,'))

    expect((await run('doctor')).stdout).toContain('Route File Names')
  })

  it('doctor stays quiet about route names when one style is used', async () => {
    expect((await run('doctor')).stdout).not.toContain('Route File Names')
  })

  it('doctor warns on a large service, and only that one', async () => {
    write('src/http/leads/leads.service.ts', 'export {}\n'.repeat(401))
    write('src/http/open/open.service.ts', 'export {}\n'.repeat(100))

    const { stdout } = await run('doctor')

    expect(stdout).toContain('leads.service.ts')
    expect(stdout).not.toContain('open.service.ts')
  })
})
