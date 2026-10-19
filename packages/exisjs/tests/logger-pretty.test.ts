// B8 (docs/REPORT.md): pino-pretty moved to @exisjs/cli, so a production
// install may not have it; pretty logging must fall back, not crash
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { describe, it, expect } from '../src/testing'

const dist = path.join(__dirname, '../dist/utils/logger.js')

describe('logger without pino-pretty', () => {
  it('logs JSON and prints one hint instead of throwing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exis-pretty-'))
    // Plain Node (no tsx loader), with pino-pretty made unresolvable
    const block = path.join(dir, 'block.js')
    fs.writeFileSync(
      block,
      `const Module = require('node:module')
      const resolve = Module._resolveFilename
      Module._resolveFilename = function (request, ...rest) {
        if (request === 'pino-pretty') {
          const err = new Error("Cannot find module 'pino-pretty'")
          err.code = 'MODULE_NOT_FOUND'
          throw err
        }
        return resolve.call(this, request, ...rest)
      }`
    )
    try {
      const run = spawnSync(
        process.execPath,
        [
          '-r',
          block,
          '-e',
          `const { createLogger } = require(${JSON.stringify(dist)})
          createLogger({ pretty: true }).info('first')
          createLogger({ pretty: true }).info('second')`,
        ],
        { encoding: 'utf8', cwd: dir }
      )
      expect(run.status).toBe(0)
      expect(run.stderr.match(/Pretty logs need pino-pretty/g)).toHaveLength(1)
      const lines = run.stdout
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
      expect(lines.map((l) => l.msg)).toEqual(['first', 'second'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
