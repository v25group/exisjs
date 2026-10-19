import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test as it, describe, expect } from '../../exisjs/src/testing'

const ROOT = path.resolve(__dirname, '..', '..')
const read = (p: string) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'))

describe('exis (short name for exisjs)', () => {
  const exis = read('exis/package.json')
  const exisjs = read('exisjs/package.json')
  const create = read('create-exis/package.json')

  it('re-exports every public entry point of exisjs', () => {
    const expected = Object.keys(exisjs.exports).filter(
      (k) => k !== './internal'
    )
    expect(Object.keys(exis.exports).sort()).toEqual(expected.sort())
    for (const [key, target] of Object.entries<any>(exis.exports)) {
      if (key === './package.json') continue
      for (const file of [target.types, target.default]) {
        expect(fs.existsSync(path.join(ROOT, 'exis', file))).toBe(true)
        expect(exis.files).toContain(file.slice(2))
      }
    }
  })

  it('gives the same objects as exisjs, so an app holds one copy', () => {
    expect(require('exis/validator').tex).toBe(require('exisjs/validator').tex)
    expect(require('exis').App).toBe(require('exisjs').App)
  })

  it('has the same version as the packages it points to', () => {
    expect(exis.dependencies.exisjs).toBe(exisjs.version)
    expect(exis.version).toBe(exisjs.version)
    expect(create.dependencies['create-exisjs']).toBe(
      read('create/package.json').version
    )
  })

  it('runs the exisjs binary', () => {
    const res = spawnSync(
      process.execPath,
      [path.join(ROOT, 'exis', 'bin', 'exis.js'), 'start', '--help'],
      { encoding: 'utf8' }
    )
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('start')
  })

  it('create-exis runs the create-exisjs binary', () => {
    expect(
      fs.existsSync(require.resolve('create-exisjs/bin/create-exis.js'))
    ).toBe(true)
  })
})
