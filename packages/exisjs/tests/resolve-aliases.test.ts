import * as path from 'node:path'
import * as fs from 'node:fs'
import { resolvePathAliases } from '../src/cli/resolve-aliases'
import { createTempDir, writeTempFile, cleanupTempDir } from './helpers'
import { describe, it, expect, beforeAll, afterAll } from '../src/testing'

describe('resolvePathAliases (ESM relative imports & aliases)', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = createTempDir('exis-aliases-')
  })

  afterAll(() => {
    cleanupTempDir(tmpDir)
  })

  it('rewrites multi-dot relative specifiers like ./user.model to ./user.model.js', async () => {
    const outDir = path.join(tmpDir, 'dist')
    const modelsDir = path.join(outDir, 'models')
    fs.mkdirSync(modelsDir, { recursive: true })

    // Create target file user.model.js
    writeTempFile(tmpDir, 'dist/models/user.model.js', 'export const User = {}')
    // Create index.js that re-exports from ./user.model
    const indexContent = `export * from './user.model'\nexport { User } from "./user.model"\nimport './side-effect'`
    writeTempFile(
      tmpDir,
      'dist/models/side-effect.js',
      'console.log("side-effect")'
    )
    writeTempFile(tmpDir, 'dist/models/index.js', indexContent)

    const rewrittenCount = await resolvePathAliases(tmpDir, 'dist')
    expect(rewrittenCount).toBeGreaterThan(0)

    const result = fs.readFileSync(path.join(modelsDir, 'index.js'), 'utf8')
    expect(result).toContain(`export * from './user.model.js'`)
    expect(result).toContain(`export { User } from "./user.model.js"`)
    expect(result).toContain(`import './side-effect.js'`)
  })

  it('rewrites directory imports to /index.js', async () => {
    const outDir = path.join(tmpDir, 'dist-dir')
    const subDir = path.join(outDir, 'sub')
    fs.mkdirSync(subDir, { recursive: true })

    writeTempFile(tmpDir, 'dist-dir/sub/index.js', 'export const ok = true')
    writeTempFile(
      tmpDir,
      'dist-dir/main.js',
      `import { ok } from './sub'\nexport const status = ok`
    )

    await resolvePathAliases(tmpDir, 'dist-dir')

    const result = fs.readFileSync(path.join(outDir, 'main.js'), 'utf8')
    expect(result).toContain(`import { ok } from './sub/index.js'`)
  })

  it('preserves imports that already have valid extensions like .js and .json', async () => {
    const outDir = path.join(tmpDir, 'dist-preserve')
    fs.mkdirSync(outDir, { recursive: true })

    writeTempFile(tmpDir, 'dist-preserve/data.json', '{"val": 1}')
    writeTempFile(tmpDir, 'dist-preserve/helper.js', 'export const h = 1')
    writeTempFile(
      tmpDir,
      'dist-preserve/app.js',
      `import data from './data.json'\nimport { h } from './helper.js'`
    )

    await resolvePathAliases(tmpDir, 'dist-preserve')

    const result = fs.readFileSync(path.join(outDir, 'app.js'), 'utf8')
    expect(result).toContain(`import data from './data.json'`)
    expect(result).toContain(`import { h } from './helper.js'`)
  })
})
