// B5 (docs/REPORT.md, 0.9.2): Ctrl+C in `exisjs dev` printed
// "Failed to start process: write EPIPE" when the child had already exited
import { fork } from 'node:child_process'
import { describe, it, expect } from '../src/testing'
import path from 'node:path'
import { isClosedChannelError, watchIgnore } from '../src/cli/commands/dev'

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
