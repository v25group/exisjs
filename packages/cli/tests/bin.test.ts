import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  test as it,
  describe,
  expect,
  afterEach,
} from '../../exisjs/src/testing'

const BIN = path.resolve(__dirname, '..', 'bin', 'exisjs.js')
const dirs: string[] = []

function project(
  deps: Record<string, string>,
  files: Record<string, string> = {}
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exis-bin-'))
  dirs.push(dir)
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: deps })
  )
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), content)
  }
  return dir
}

const run = (cwd: string, ...args: string[]) =>
  spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, EXIS_NO_CLI_NOTICE: '' },
  })

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe('exisjs binary', () => {
  it("hands off to the project's own @exisjs/cli (global install, W1)", () => {
    const cwd = project(
      { exisjs: '0.10.0' },
      {
        'node_modules/@exisjs/cli/package.json': '{"name":"@exisjs/cli"}',
        'node_modules/@exisjs/cli/bin/exisjs.js': 'console.log("local cli")',
      }
    )
    const res = run(cwd, '--version')
    expect(res.stdout.trim()).toBe('local cli')
  })

  it('refuses to run next to an exisjs without @exisjs/cli', () => {
    const cwd = project(
      { exisjs: '0.10.0' },
      {
        'node_modules/exisjs/package.json':
          '{"name":"exisjs","version":"0.10.0-alpha.1"}',
      }
    )
    const res = run(cwd, 'dev')
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('npm install -D @exisjs/cli@0.10.0-alpha.1')
  })

  it('suggests migrate when package.json lists exisjs but not @exisjs/cli', () => {
    const res = run(project({ exisjs: '0.10.0' }), '--version')
    expect(res.status).toBe(0)
    expect(res.stderr).toContain('npx exisjs migrate')
  })

  it('says nothing once @exisjs/cli is listed', () => {
    const res = run(
      project({ exisjs: '0.10.0', '@exisjs/cli': '0.10.0' }),
      '--version'
    )
    expect(res.stderr).not.toContain('migrate')
  })
})
