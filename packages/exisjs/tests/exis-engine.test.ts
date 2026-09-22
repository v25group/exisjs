import { describe, expect, it, beforeEach, afterEach } from '../src/testing'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { generateManifest, atomicWriteFile } from '../src/cli/manifest'
import { cleanCommand } from '../src/cli/commands/clean'
import { App } from '../src/server/app'

describe('.exis Directory Engine & Manifest Improvements', () => {
  let tmpDir: string
  let app: App | null = null

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'exis-engine-test-'))
  })

  afterEach(async () => {
    if (app) {
      app.cron.stopAll()
      app = null
    }
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  it('performs atomic file writes without data corruption', async () => {
    const targetFile = path.join(tmpDir, '.exis', 'types.d.ts')
    const content = 'export type AppRouter = { test: true }'

    await atomicWriteFile(targetFile, content)

    const read = await fs.readFile(targetFile, 'utf8')
    expect(read).toBe(content)
  })

  it('cleans .exis directory via cleanCommand', async () => {
    const exisDir = path.join(tmpDir, '.exis')
    await fs.mkdir(exisDir, { recursive: true })
    await fs.writeFile(path.join(exisDir, 'test.txt'), 'hello', 'utf8')

    // Change cwd to tmpDir for cleanCommand
    const origCwd = process.cwd()
    try {
      process.chdir(tmpDir)
      await cleanCommand()
      const exists = await fs
        .stat(exisDir)
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(false)
    } finally {
      process.chdir(origCwd)
    }
  })

  it('pre-compiles routes, errorHandler, and cronJobs into routes-manifest.js', async () => {
    const httpDir = path.join(tmpDir, 'src', 'http')
    const cronDir = path.join(tmpDir, 'src', 'cron')
    await fs.mkdir(httpDir, { recursive: true })
    await fs.mkdir(cronDir, { recursive: true })

    const routerPath = path.join(__dirname, '../src/router').replace(/\\/g, '/')

    // Create a route file
    await fs.writeFile(
      path.join(httpDir, 'route.js'),
      `
      const { route, controller } = require('${routerPath}')
      exports.default = controller({
        ping: route.get('/ping', () => ({ message: 'pong' }))
      })
      `
    )

    // Create an error file
    await fs.writeFile(
      path.join(httpDir, 'error.js'),
      `
      exports.default = (err, req, res) => {
        res.status(500).json({ customError: err.message })
      }
      `
    )

    // Create a cron file
    await fs.writeFile(
      path.join(cronDir, 'sync.js'),
      `
      exports.default = {
        __isExisCron: true,
        options: {
          name: 'manifest-sync-job',
          schedule: '0 0 * * *',
          autoStart: false,
          run: async () => ({ synced: true })
        }
      }
      `
    )

    await generateManifest(tmpDir, '.exis/server', false)

    const manifestFile = path.join(tmpDir, '.exis', 'routes-manifest.js')
    const manifestContent = await fs.readFile(manifestFile, 'utf8')

    expect(manifestContent).toContain('export const manifest =')
    expect(manifestContent).toContain('export const errorHandler =')
    expect(manifestContent).toContain('export const cronJobs =')
    expect(manifestContent).toContain('src/cron/sync.js')

    // Test booting App via pre-compiled manifest
    app = new App()
    await app.autoMountRoutes(tmpDir)

    // Verify cron was mounted from pre-compiled manifest
    expect(app.cron.has('manifest-sync-job')).toBe(true)
    const cronRes = await app.cron.trigger('manifest-sync-job')
    expect(cronRes).toEqual({ synced: true })
  })
})
