// B8 (docs/REPORT.md): `node .exis/server/main.js` runs the server as one
// process (or one cluster primary), and shuts it down gracefully on SIGTERM
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { describe, it, expect } from '../../exisjs/src/testing'
import { writeMainEntry } from '../src/commands/build'

const MODULES = path.resolve(__dirname, '../../../node_modules')

// A built app as `exisjs build` leaves it: .exis/server/src/http/server.js
function builtApp(config: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exis-main-'))
  const http = path.join(dir, '.exis', 'server', 'src', 'http')
  fs.mkdirSync(path.join(http, 'slow'), { recursive: true })
  fs.writeFileSync(
    path.join(http, 'server.js'),
    `const fs = require('node:fs')
    const { exis } = require('exisjs')
    const { registerDatabase } = require('exisjs/database')
    module.exports = exis({
      onStart() {
        registerDatabase({
          name: 'fake',
          connect: () => {},
          disconnect: () => fs.writeFileSync(process.env.DB_MARKER, 'closed'),
        })
      },
    })`
  )
  fs.writeFileSync(
    path.join(http, 'slow', 'route.js'),
    `const cluster = require('node:cluster')
    const { controller, route } = require('exisjs/router')
    exports.default = controller({
      slow: route.get('/', {
        async handle() {
          await new Promise((r) => setTimeout(r, Number(process.env.SLOW_MS || 0)))
          return { pid: process.pid, ppid: process.ppid, worker: cluster.isWorker, env: process.env.NODE_ENV }
        },
      }),
    })`
  )
  fs.writeFileSync(
    path.join(dir, 'exis.config.js'),
    `module.exports = ${config}`
  )
  writeMainEntry(dir, path.join('.exis', 'server'), false)
  return dir
}

function start(dir: string, env: Record<string, string>): ChildProcess {
  return spawn(
    process.execPath,
    [path.join(dir, '.exis', 'server', 'main.js')],
    {
      // Started from elsewhere: main.js changes to the project itself.
      // NODE_ENV is empty, as some platforms leave it: main.js means production
      cwd: os.tmpdir(),
      env: { ...process.env, NODE_PATH: MODULES, NODE_ENV: '', ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  )
}

async function waitFor(url: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`${url} did not come up`)
}

// main.js runs inside the project folder, which Windows will not delete
// until that process has exited
async function stop(child: ChildProcess, dir: string): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((r) => child.once('exit', r))
    // On Windows a killed cluster primary leaves its workers running a
    // while; end the whole tree so the folder can be removed
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
      })
    } else {
      child.kill('SIGKILL')
    }
    await exited
  }
  fs.rmSync(dir, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  })
}

// A port the OS just handed out, so parallel test files never collide
async function freePort(): Promise<number> {
  const srv = net.createServer()
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const { port } = srv.address() as net.AddressInfo
  await new Promise((r) => srv.close(r))
  return port
}
const CONFIG =
  '{ port: Number(process.env.PORT), logger: false, env: process.env.NODE_ENV }'

describe('node .exis/server/main.js', () => {
  it('serves from one process, in production mode', async () => {
    const dir = builtApp(CONFIG)
    const p = await freePort()
    const child = start(dir, {
      PORT: String(p),
      DB_MARKER: path.join(dir, 'db'),
    })
    try {
      await waitFor(`http://127.0.0.1:${p}/slow`)
      const body: any = await (await fetch(`http://127.0.0.1:${p}/slow`)).json()
      expect(body.pid).toBe(child.pid)
      expect(body.worker).toBe(false)
      expect(body.env).toBe('production')
    } finally {
      await stop(child, dir)
    }
  })

  it('in cluster mode, workers are forked by main.js itself', async () => {
    const dir = builtApp(CONFIG.replace(' }', ', cluster: { workers: 2 } }'))
    const p = await freePort()
    const child = start(dir, {
      PORT: String(p),
      DB_MARKER: path.join(dir, 'db'),
    })
    try {
      await waitFor(`http://127.0.0.1:${p}/slow`)
      const body: any = await (await fetch(`http://127.0.0.1:${p}/slow`)).json()
      expect({ worker: body.worker, ppid: body.ppid }).toEqual({
        worker: true,
        ppid: child.pid,
      })
    } finally {
      await stop(child, dir)
    }
  })

  // Windows has no SIGTERM handlers: kill() there ends the process at once
  it(
    'on SIGTERM finishes the request in progress, closes the database and exits 0',
    { skip: process.platform === 'win32' },
    async () => {
      const dir = builtApp(CONFIG)
      const p = await freePort()
      const marker = path.join(dir, 'db')
      const child = start(dir, {
        PORT: String(p),
        DB_MARKER: marker,
        SLOW_MS: '600',
      })
      const exited = new Promise<number | null>((r) => child.once('exit', r))
      try {
        await waitFor(`http://127.0.0.1:${p}/slow`)
        const inFlight = fetch(`http://127.0.0.1:${p}/slow`)
        await new Promise((r) => setTimeout(r, 150))
        child.kill('SIGTERM')
        await new Promise((r) => setTimeout(r, 100))

        // Started before SIGTERM: still answered
        expect((await inFlight).status).toBe(200)
        // New connections are refused while it drains
        await expect(fetch(`http://127.0.0.1:${p}/slow`)).rejects.toThrow()
        expect(await exited).toBe(0)
        expect(fs.readFileSync(marker, 'utf8')).toBe('closed')
      } finally {
        await stop(child, dir)
      }
    }
  )
})
