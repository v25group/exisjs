import * as fs from 'node:fs'
import * as path from 'node:path'
import * as dotenv from 'dotenv'
import { expand as dotenvExpand } from 'dotenv-expand'

export type Env = Record<string, string | undefined>
export type LoadedEnvFiles = {
  path: string
  contents: string
  env: Env
}[]

export let initialEnv: Env | undefined = undefined
let combinedEnv: Env | undefined = undefined
let parsedEnv: Env | undefined = undefined
let cachedLoadedEnvFiles: LoadedEnvFiles = []
let _previousLoadedEnvFiles: LoadedEnvFiles = []

function replaceProcessEnv(sourceEnv: Env) {
  Object.keys(process.env).forEach((key) => {
    if (sourceEnv[key] === undefined || sourceEnv[key] === '') {
      delete process.env[key]
    }
  })
  Object.entries(sourceEnv).forEach(([key, value]) => {
    if (value !== undefined) {
      process.env[key] = value
    }
  })
}

export function processEnv(
  loadedEnvFiles: LoadedEnvFiles,
  dir?: string,
  forceReload = false
) {
  if (!initialEnv) {
    initialEnv = Object.assign({}, process.env)
  }

  if (
    !forceReload &&
    (process.env.__EXIS_PROCESSED_ENV || loadedEnvFiles.length === 0)
  ) {
    return [process.env as Env]
  }

  process.env.__EXIS_PROCESSED_ENV = 'true'

  const origEnv = Object.assign({}, initialEnv)
  const parsed: dotenv.DotenvParseOutput = {}
  for (const envFile of loadedEnvFiles) {
    try {
      let result: any = {}
      result.parsed = dotenv.parse(envFile.contents)
      result = dotenvExpand(result)
      for (const key of Object.keys(result.parsed || {})) {
        if (
          typeof parsed[key] === 'undefined' &&
          typeof origEnv[key] === 'undefined'
        ) {
          parsed[key] = result.parsed[key]
        }
      }
      envFile.env = result.parsed || {}
    } catch (err) {
      console.error(
        `Failed to load env from ${path.join(dir || '', envFile.path)}`,
        err
      )
    }
  }

  return [Object.assign(process.env, parsed), parsed]
}
export function resetEnv() {
  if (initialEnv) {
    replaceProcessEnv(initialEnv)
  }
}
/**
 * Automatically loads .env files into process.env.
 *  * Looks for .env in the current working directory, expanding variables
 * and respecting environment overrides (.env.[mode].local > .env.local > .env.[mode] > .env).
 */

export function loadEnv(
  dir: string = process.cwd(),
  mode?: string,
  forceReload = false
): {
  combinedEnv: Env
  parsedEnv: Env | undefined
  loadedEnvFiles: LoadedEnvFiles
} {
  if (!initialEnv) {
    initialEnv = Object.assign({}, process.env)
  }
  if (combinedEnv && !forceReload) {
    return { combinedEnv, parsedEnv, loadedEnvFiles: cachedLoadedEnvFiles }
  }
  replaceProcessEnv(initialEnv)
  _previousLoadedEnvFiles = cachedLoadedEnvFiles
  cachedLoadedEnvFiles = []
  const _isTest = process.env.NODE_ENV === 'test'
  const currentMode = mode || process.env.NODE_ENV || 'development'

  const dotenvFiles = [
    `.env.${currentMode}.local`,
    currentMode !== 'test' && `.env.local`,
    `.env.${currentMode}`,
    '.env',
  ].filter(Boolean) as string[]
  for (const envFile of dotenvFiles) {
    const dotEnvPath = path.join(dir, envFile)
    try {
      if (!fs.existsSync(dotEnvPath)) {
        continue
      }

      const stats = fs.statSync(dotEnvPath)
      if (!stats.isFile() && !stats.isFIFO()) {
        continue
      }
      const contents = fs.readFileSync(dotEnvPath, 'utf8')
      cachedLoadedEnvFiles.push({
        path: envFile,
        contents,
        env: {},
      })
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.error(`Failed to load env from ${envFile}`, err)
      }
    }
  }
  const results = processEnv(cachedLoadedEnvFiles, dir, forceReload)
  combinedEnv = results[0] as Env
  parsedEnv = results[1] as Env
  return { combinedEnv, parsedEnv, loadedEnvFiles: cachedLoadedEnvFiles }
}
/**
 * Parses a string containing .env formatted content natively for simple use-cases.
 * This does NOT expand variables. Use `loadEnv` for standard behavior.
 */
export function parseEnv(src: string): Record<string, string> {
  return dotenv.parse(src)
}
