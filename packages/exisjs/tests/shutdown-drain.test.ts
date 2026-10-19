// Found verifying B8 in Docker: when a request was still running at
// shutdown, the process exited as soon as it finished, before onClose
// hooks and database disconnects ran (the drain timer kept nothing alive)
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, it, expect } from '../src/testing'

const dist = path.join(__dirname, '../dist').split(path.sep).join('/')

describe('graceful shutdown with a request in progress', () => {
  it('finishes the request, then runs onClose and disconnects databases', () => {
    const script = `
      const http = require('node:http')
      const { App } = require('${dist}/server/app.js')
      const { DatabaseManager } = require('${dist}/database/lifecycle.js')
      const app = new App({ logger: false, server: 'node' })
      DatabaseManager.register({ name: 'db', connect() {}, disconnect() { console.log('db disconnected') } })
      app.onCloseHook = () => console.log('onClose ran')
      app.get('/slow', async () => { await new Promise((r) => setTimeout(r, 300)); return { ok: true } })
      const server = app.listen({ port: 0, host: '127.0.0.1', onListen({ port }) {
        // Like curl: a client that closes its connection, which then holds nothing open
        http.get('http://127.0.0.1:' + port + '/slow', { agent: false, headers: { connection: 'close' } }, (res) => {
          res.resume(); res.on('end', () => console.log('request answered ' + res.statusCode))
        })
        setTimeout(() => app.close(5000), 100)
      } })`
    const run = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      timeout: 20000,
    })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('request answered 200')
    expect(run.stdout).toContain('onClose ran')
    expect(run.stdout).toContain('db disconnected')
  })
})
