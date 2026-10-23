import path from 'node:path'
import { describe, it, expect } from '../src/testing'

// The event order node:test produced for three files run together: a file's
// own completion arrives before its tests are reported, a passing file ends
// with its own summary, and a failing one with a file-level test:fail
const dir = path.resolve('tests')
const ok = path.join(dir, 'ok.test.ts')
const hang = path.join(dir, 'hang.test.ts')
const ev = (type: string, data: Record<string, unknown>) => ({ type, data })
const events = [
  ev('test:complete', { name: 'tests\\ok.test.ts', nesting: 0, file: ok }),
  ev('test:start', { name: 'hanging file', nesting: 0, file: hang }),
  ev('test:start', { name: 'leaves a timer', nesting: 1, file: hang }),
  ev('test:pass', {
    name: 'leaves a timer',
    nesting: 1,
    file: hang,
    details: {},
  }),
  ev('test:pass', {
    name: 'hanging file',
    nesting: 0,
    file: hang,
    details: { type: 'suite' },
  }),
  ev('test:stderr', {
    file: hang,
    message: 'Tests finished but the process did not exit',
  }),
  ev('test:start', { name: 'tests\\hang.test.ts', nesting: 0, file: hang }),
  ev('test:fail', {
    name: 'tests\\hang.test.ts',
    nesting: 0,
    file: hang,
    details: { error: { message: 'test failed' } },
  }),
  ev('test:start', { name: 'fine', nesting: 0, file: ok }),
  ev('test:pass', { name: 'fine', nesting: 0, file: ok, details: {} }),
  ev('test:summary', { file: ok }),
  ev('test:summary', {}),
]

async function run(): Promise<string> {
  const { default: reporter } = await import('../src/testing/reporter.mjs')
  async function* source() {
    yield* events as any[]
  }
  let out = ''
  const prev = process.exitCode
  for await (const chunk of reporter(source())) out += chunk
  process.exitCode = prev
  return out
}

describe('test reporter', () => {
  it('prints each file once it ends, with the right badge and every test', async () => {
    const out = await run()
    const hangAt = out.indexOf('FAIL  exis')
    const okAt = out.indexOf('PASS  exis')

    expect(hangAt).toBeGreaterThan(-1)
    expect(okAt).toBeGreaterThan(hangAt)
    expect(out).toContain('leaves a timer')
    expect(out).toContain('did not exit')
    expect(out.indexOf('fine')).toBeGreaterThan(okAt)
    expect(out).toContain('1 failed')
    expect(out).toContain('2 passed, 2 total')
  })
})
