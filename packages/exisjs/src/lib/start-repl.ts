import repl from 'node:repl'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

async function startRepl() {
  const entryFile = process.env.EXIS_ENTRY_FILE

  if (!entryFile) {
    console.error('EXIS_ENTRY_FILE environment variable is missing.')
    process.exit(1)
  }

  try {
    const cwd = process.cwd()
    const dynamicImport = new Function('specifier', 'return import(specifier)')

    // 1. Load .env files so process.env is populated
    const { loadEnv } = await import('../config/env.js')
    loadEnv(cwd)

    // 2. Auto-load Environment variables validation file if it exists
    const envFiles = [
      path.join(cwd, 'src', 'config', 'env.ts'),
      path.join(cwd, 'src', 'config', 'env.js'),
    ]

    for (const envFile of envFiles) {
      if (fs.existsSync(envFile)) {
        await dynamicImport(pathToFileURL(envFile).href)
        break
      }
    }

    const url = pathToFileURL(entryFile).href
    const mod = await dynamicImport(url)

    // Support declarative `export default exis({ ... })`
    const app = mod.default || mod.app
    if (
      app &&
      typeof app.create === 'function' &&
      typeof app.listen === 'function'
    ) {
      // Boot the app plugins and database connections without starting HTTP server
      await app.create()
      if (typeof app.onStartHook === 'function') {
        await app.onStartHook(app)
      }
    }

    // 3. Auto-discover and inject Models
    const modelsToInject: Record<string, any> = {}

    const possibleModelDirs = [
      path.join(cwd, 'src', 'models'),
      path.join(cwd, 'models'),
    ]

    for (const dir of possibleModelDirs) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir)
        for (const file of files) {
          if (file.endsWith('.ts') || file.endsWith('.js')) {
            const modelPath = path.join(dir, file)
            const modelUrl = pathToFileURL(modelPath).href
            const modelMod = await dynamicImport(modelUrl).catch(() => ({}))

            // Look for exported classes/variables that might be models
            for (const key in modelMod) {
              if (key === 'default') {
                const name = path.basename(file, path.extname(file))
                modelsToInject[name] = modelMod.default
              } else {
                modelsToInject[key] = modelMod[key]
              }
            }
          }
        }
      }
    }

    if (Object.keys(modelsToInject).length > 0) {
      console.log(
        `\x1b[32m[exis]\x1b[0m Auto-injected models: ${Object.keys(modelsToInject).join(', ')}`
      )
    }

    const replServer = repl.start({ prompt: 'exis> ' })
    replServer.context.app = app
    Object.assign(replServer.context, modelsToInject)
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

startRepl()
