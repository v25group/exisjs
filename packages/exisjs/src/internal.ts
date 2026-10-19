/**
 * Runtime pieces used by `@exisjs/cli` (`exisjs/internal`).
 *
 * Not part of the public API: names and signatures may change in any
 * release. The CLI is versioned together with this package.
 */
import path from 'node:path'

export { loadConfig } from './config/config'
export { loadEnv, parseEnv } from './config/env'
export { App, setActiveAppInstance } from './server/app'
export {
  RouteScanner,
  routeParadigm,
  mixedParadigmMessage,
} from './router/route-scanner'
export { describeAccess } from './router/authorize'
export { formatCliError, formatDevError } from './error/overlay'
export {
  registerPathAliasLoader,
  resolvePathAliases,
} from './lib/resolve-aliases'
export { getFormattedTime } from './utils/time'
export { startBuiltServer, type StartOptions } from './lib/start-command'

/** The production server entry (`exisjs/start`) */
export const START_SERVER_PATH = path.join(__dirname, 'lib', 'start-server.js')

/** The `node:test` reporter used by `exisjs test` */
export const TEST_REPORTER_PATH = path.join(
  __dirname,
  'testing',
  'reporter.mjs'
)

/** The installed runtime version, which the CLI must match */
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const RUNTIME_VERSION: string = require('../package.json').version
