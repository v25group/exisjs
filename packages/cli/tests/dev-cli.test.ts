// B5 (docs/REPORT.md, 0.9.2): Ctrl+C in `exisjs dev` printed
// "Failed to start process: write EPIPE" when the child had already exited
import { fork } from 'node:child_process'
import { describe, it, expect } from '../../exisjs/src/testing'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import {
  describeChanges,
  findPortOwner,
  isClosedChannelError,
  modifiedSince,
  shouldReloadOnFile,
  waitForPortFree,
  watchIgnore,
  writeDevStatusFile,
} from '../src/commands/dev'

describe('exisjs dev shutdown', () => {
  it('treats a closed IPC channel as expected, other errors not', () => {
    for (const code of [
      'EPIPE',
      'ERR_IPC_CHANNEL_CLOSED',
      'ERR_IPC_DISCONNECTED',
    ]) {
      expect(
        isClosedChannelError(Object.assign(new Error('x'), { code }))
      ).toBe(true)
    }
    expect(
      isClosedChannelError(Object.assign(new Error('x'), { code: 'ENOENT' }))
    ).toBe(false)
    expect(isClosedChannelError(null)).toBe(false)
  })

  it('a send with a callback to an exited child reports to the callback, not as an error event', async () => {
    const child = fork('-e', ['process.exit(0)'], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    await new Promise((r) => child.once('exit', r))
    let errorEvents = 0
    child.on('error', () => errorEvents++)
    const sendError = await new Promise<Error | null>((resolve) => {
      try {
        child.send({ type: 'exis:shutdown' }, resolve)
      } catch (err) {
        resolve(err as Error)
      }
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(sendError).toBeInstanceOf(Error)
    expect(isClosedChannelError(sendError as NodeJS.ErrnoException)).toBe(true)
    expect(errorEvents).toBe(0)
  })
})

// B6 (docs/REPORT.md, 0.9.2): nothing reloaded, .env included, when the
// project sat under a folder whose name is an ignore pattern (temp, data...)
describe('exisjs dev watcher', () => {
  const cwd = path.resolve('/home/me/Temp/data/build/shop-api')
  const ignored = watchIgnore(cwd, ['generated'])

  it('applies ignore patterns to the path inside the project only', () => {
    expect(ignored(path.join(cwd, 'src/http/users/route.ts'))).toBe(false)
    expect(ignored(path.join(cwd, '.env'))).toBe(false)
    expect(ignored(path.join(cwd, '.env.local'))).toBe(false)
    expect(ignored(cwd)).toBe(false)
  })

  it('still ignores what is inside the project', () => {
    expect(ignored(path.join(cwd, 'node_modules/x/index.js'))).toBe(true)
    expect(ignored(path.join(cwd, 'dist/server.js'))).toBe(true)
    expect(ignored(path.join(cwd, '.git/HEAD'))).toBe(true)
    expect(ignored(path.join(cwd, 'src/tmp/cache.ts'))).toBe(true)
    expect(ignored(path.join(cwd, 'src/generated/types.ts'))).toBe(true)
    expect(ignored('dist/server.js')).toBe(true)
  })
})

// B56 (docs/REPORT.md, 0.10.2): a source folder named like a data folder
// (src/http/api/reports) was ignored, so edits there never reloaded
describe('exisjs dev: source folders with data-like names', () => {
  it('reloads source files in folders named reports, uploads, logs, data, public, test or build', () => {
    for (const dir of [
      'reports',
      'uploads',
      'logs',
      'data',
      'public',
      'storage',
      'test',
      'build',
      'dist',
    ]) {
      expect(shouldReloadOnFile(`src/http/api/${dir}/service.ts`)).toBe(true)
      expect(shouldReloadOnFile(`src\\http\\api\\${dir}\\route.ts`)).toBe(true)
    }
  })

  it('still ignores those folders at the project root, and data files anywhere', () => {
    expect(shouldReloadOnFile('reports/2026.ts')).toBe(false)
    expect(shouldReloadOnFile('dist/server.js')).toBe(false)
    expect(shouldReloadOnFile('src/http/api/reports/sample.csv')).toBe(false)
    expect(shouldReloadOnFile('src/tmp/cache.ts')).toBe(false)
  })

  it('ignores one-off scripts', () => {
    expect(shouldReloadOnFile('tmp-paid.ts')).toBe(false)
    expect(shouldReloadOnFile('src\\tmp-x.ts')).toBe(false)
    expect(shouldReloadOnFile('scratch-import.ts')).toBe(false)
    expect(shouldReloadOnFile('src/http/api/tmp-dates/route.ts')).toBe(true)
  })
})

// B52 (docs/REPORT.md, 0.10.2): with polling, every file was reported as
// changed on the first pass, so the server restarted right after starting
describe('exisjs dev: changes that are not changes', () => {
  it('a file untouched since the watcher started has not changed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exis-mtime-'))
    const file = path.join(dir, 'a.ts')
    fs.writeFileSync(file, 'export {}')
    const old = new Date(Date.now() - 60_000)
    fs.utimesSync(file, old, old)

    const startedAt = Date.now()
    expect(await modifiedSince(file, startedAt)).toBe(false)
    fs.writeFileSync(file, 'export const a = 1')
    expect(await modifiedSince(file, startedAt)).toBe(true)
    expect(await modifiedSince(path.join(dir, 'gone.ts'), startedAt)).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('names what happened in the reload line', () => {
    expect(describeChanges([['src/a.ts', 'change']])).toBe('src/a.ts changed')
    expect(
      describeChanges([
        ['src/a.ts', 'add'],
        ['src/b.ts', 'change'],
        ['src/c.ts', 'unlink'],
      ])
    ).toBe('src/a.ts added (+2 other files: 1 changed, 1 deleted)')
  })
})

// B54 (docs/REPORT.md, 0.10.2): a restart could start the new app process
// while the old one, or the error page, still held the port
describe('exisjs dev: restarts and the port', () => {
  it('waits for a port to be released', async () => {
    const server = net.createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as net.AddressInfo).port

    expect(await waitForPortFree(port, '127.0.0.1', 200)).toBe(false)
    setTimeout(() => server.close(), 150)
    expect(await waitForPortFree(port, '127.0.0.1', 3000)).toBe(true)
  })

  it('names the process listening on a port', async () => {
    const server = net.createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as net.AddressInfo).port
    const owner = findPortOwner(port)
    server.close()
    // netstat or lsof may be missing on a CI image; when found, it's us
    if (owner !== null) expect(owner).toBe(process.pid)
  })

  it('writes restarts and errors to dev-status.json for other tools', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exis-status-'))
    fs.writeFileSync(
      path.join(dir, 'dev-status.json'),
      JSON.stringify({ routeCount: 3, status: 'ok' })
    )
    const state = {
      port: 4000,
      pid: 123,
      startedAt: '2026-11-13T09:28:00.000Z',
      restarts: 2,
      serverError: null as string | null,
      typeErrors: ["src/a.ts(1,7): error TS2322: Type 'string'"],
    }
    writeDevStatusFile(dir, state)
    let status = JSON.parse(
      fs.readFileSync(path.join(dir, 'dev-status.json'), 'utf8')
    )
    expect(status.routeCount).toBe(3)
    expect(status.status).toBe('error')
    expect(status.server.restarts).toBe(2)
    expect(status.typeErrors).toHaveLength(1)

    writeDevStatusFile(dir, { ...state, typeErrors: [] })
    status = JSON.parse(
      fs.readFileSync(path.join(dir, 'dev-status.json'), 'utf8')
    )
    expect(status.status).toBe('ok')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
