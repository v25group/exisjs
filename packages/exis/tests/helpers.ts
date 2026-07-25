export * from '../src/testing/mocks'
import { Logger } from '../src/types'

export function createMockLogger(): Logger {
  const noop = jest.fn()
  return {
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    silent: noop,
    level: 'silent',
    child: jest.fn(() => createMockLogger()),
  }
}

export function createMockNext() {
  return jest.fn()
}

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export function createTempDir(prefix = 'exis-test-'): string {
  const tmpDir = os.tmpdir()
  return fs.mkdtempSync(path.join(tmpDir, prefix))
}

export function writeTempFile(
  dir: string,
  filepath: string,
  content: string
): string {
  const fullPath = path.join(dir, filepath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content, 'utf8')
  return fullPath
}

export function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
