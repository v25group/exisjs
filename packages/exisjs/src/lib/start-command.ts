// `exisjs start`: boots a built app. It lives in the runtime, not in
// @exisjs/cli, so production installs without development dependencies can
// still run `exisjs start` (or `npm start`).
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const START_SERVER_PATH = path.join(__dirname, 'start-server.js')

export interface StartOptions {
  entry?: string
  port?: string
  host?: string
}

// tsc compiles import() to require() for CommonJS; main.js may be ESM
const importModule = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<unknown>

/**
 * Starts the built server in this process, so it receives SIGINT / SIGTERM
 * itself and shuts down gracefully (the same as `node .exis/server/main.js`).
 */
export async function startBuiltServer(
  options: StartOptions = {},
  // Loads the server; tests pass a stub instead of starting one
  load: (specifier: string) => Promise<unknown> = importModule
): Promise<void> {
  const cwd = process.cwd()

  if (options.port) process.env.PORT = options.port
  if (options.host) process.env.HOST = options.host
  process.env.NODE_ENV = 'production'
  process.env.__EXIS_CLI = 'true'

  const mainFile = path.join(cwd, '.exis', 'server', 'main.js')
  if (!options.entry && fs.existsSync(mainFile)) {
    await load(pathToFileURL(mainFile).href)
    return
  }

  // Builds made before main.js existed, or a custom --entry
  const entryFile = resolveDistEntry(cwd, options.entry)
  if (!entryFile) {
    console.error(
      '\x1b[31m✗\x1b[0m No compiled output found. Run `exisjs build` first.'
    )
    process.exit(1)
  }
  process.env.EXIS_ENTRY_FILE = entryFile
  await load(pathToFileURL(START_SERVER_PATH).href)
}

function resolveDistEntry(cwd: string, custom?: string): string | null {
  if (custom) {
    const abs = path.resolve(cwd, custom)
    return fs.existsSync(abs) ? abs : null
  }

  const srcJs = path.join(cwd, '.exis/server/src/http/server.js')
  const rootJs = path.join(cwd, '.exis/server/http/server.js')
  const distSrcJs = path.join(cwd, 'dist/src/http/server.js')
  const distRootJs = path.join(cwd, 'dist/http/server.js')
  const rawSrcJs = path.join(cwd, 'src/http/server.js')
  const rawRootJs = path.join(cwd, 'http/server.js')

  const hasSrc =
    fs.existsSync(srcJs) || fs.existsSync(distSrcJs) || fs.existsSync(rawSrcJs)
  const hasRoot =
    fs.existsSync(rootJs) ||
    fs.existsSync(distRootJs) ||
    fs.existsSync(rawRootJs)

  if (hasSrc && hasRoot) {
    console.error(
      '\n\x1b[31m Ambiguous Entry Point Error\x1b[0m\n' +
        'You have server entry files in both "src/http" and "http" directories.\n' +
        'Please keep only one of them to prevent unexpected behavior.\n'
    )
    process.exit(1)
  }

  if (fs.existsSync(srcJs)) return srcJs
  if (fs.existsSync(rootJs)) return rootJs
  if (fs.existsSync(distSrcJs)) return distSrcJs
  if (fs.existsSync(distRootJs)) return distRootJs
  if (fs.existsSync(rawSrcJs)) return rawSrcJs
  if (fs.existsSync(rawRootJs)) return rawRootJs

  return null
}
