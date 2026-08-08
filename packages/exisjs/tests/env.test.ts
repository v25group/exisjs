import * as path from 'node:path'
import { parseEnv, loadEnv, resetEnv } from '../src/utils/env'
import { createTempDir, cleanupTempDir, writeTempFile } from './helpers'
import { describe, it, expect, beforeEach, afterEach } from '../src/testing'

describe('Env Parser', () => {
  it('parses basic key value pairs using dotenv natively', () => {
    const src = 'PORT=3000\nNODE_ENV=development\n'
    const parsed = parseEnv(src)
    expect(parsed).toEqual({
      PORT: '3000',
      NODE_ENV: 'development',
    })
  })

  it('handles single quotes', () => {
    const src = "SECRET='my-secret'"
    const parsed = parseEnv(src)
    expect(parsed).toEqual({ SECRET: 'my-secret' })
  })

  it('handles double quotes and expands newlines', () => {
    const src = 'PRIVATE_KEY="line1\\nline2"'
    const parsed = parseEnv(src)
    expect(parsed).toEqual({ PRIVATE_KEY: 'line1\nline2' })
  })
})

describe('loadEnv', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempDir('env-test-')
    resetEnv()
    // clear the __EXIS_PROCESSED_ENV flag
    delete process.env.__EXIS_PROCESSED_ENV
  })

  afterEach(() => {
    cleanupTempDir(tmpDir)
    resetEnv()
  })

  it('loads .env file into process.env', () => {
    writeTempFile(tmpDir, '.env', 'TEST_ENV_VAR=123\nTEST_EXISTING=new')

    // Set existing
    process.env.TEST_EXISTING = 'old'

    loadEnv(tmpDir, 'development', true)

    expect(process.env.TEST_ENV_VAR).toBe('123')
    expect(process.env.TEST_EXISTING).toBe('old') // Should not overwrite existing process env
  })

  it('supports variable expansion via dotenv-expand', () => {
    writeTempFile(
      tmpDir,
      '.env',
      'HOST=localhost\nPORT=8080\nURL=http://${HOST}:${PORT}'
    )

    loadEnv(tmpDir, 'development', true)

    expect(process.env.URL).toBe('http://localhost:8080')
  })

  it('cascades files correctly (.env.local overrides .env)', () => {
    writeTempFile(tmpDir, '.env', 'OVERRIDE_ME=base\nKEEP_ME=kept')
    writeTempFile(tmpDir, '.env.local', 'OVERRIDE_ME=local_value')

    loadEnv(tmpDir, 'development', true)

    expect(process.env.OVERRIDE_ME).toBe('local_value')
    expect(process.env.KEEP_ME).toBe('kept')
  })

  it('supports mode specific files (.env.production overrides .env)', () => {
    writeTempFile(tmpDir, '.env', 'DB_NAME=dev_db')
    writeTempFile(tmpDir, '.env.production', 'DB_NAME=prod_db')

    loadEnv(tmpDir, 'production', true)

    expect(process.env.DB_NAME).toBe('prod_db')
  })
})
