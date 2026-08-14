import type { ExisConfig } from '../types'
import path from 'node:path'
import fs from 'node:fs'

// ─── defineConfig ─────────────────────────────────────────────────────────────

export function defineConfig(config: ExisConfig): ExisConfig {
  return config
}

// ─── Default Config ───────────────────────────────────────────────────────────

export type ResolvedConfig = Omit<Required<ExisConfig>, 'ssl'> & {
  ssl?: ExisConfig['ssl']
}

export const defaultConfig: ResolvedConfig = {
  port: 4000,
  host: '0.0.0.0',

  http2: true,
  redirectHttp: false,
  etag: false,
  telemetry: {
    enabled: false,
    exporter: 'console',
  },
  metrics: {
    enabled: false,
    path: '/metrics',
  },
  healthcheck: {
    enabled: false,
    path: '/_health',
    checks: [],
  },
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  },
  logger: false,
  helmet: { enabled: true },
  trustProxy: false,
  bodyLimit: 1 * 1024 * 1024,
  env: (process.env.NODE_ENV as ExisConfig['env']) ?? 'development',
  compression: false,
  keepAlive: false,
  server: 'auto' as 'auto' | 'node' | 'bun', // Auto-detect backend
  queue: undefined as any,
  test: undefined as any,
  plugins: [],
  workers: 1,
  cluster: { workers: 1 },
  debugRouting: false,
  asyncContext: false,
}

// ─── Deep merge ───────────────────────────────────────────────────────────────

export function mergeConfig(
  base: ResolvedConfig,
  override: ExisConfig
): ResolvedConfig {
  const result = { ...base }

  for (const key of Object.keys(override) as (keyof ExisConfig)[]) {
    const val = override[key]
    if (val === null) {
      console.warn(
        `\x1b[33m[Exis Warning]\x1b[0m Config override for '${key}' is null. Treating as false (disabled).`
      )
      ;(result as Record<string, unknown>)[key] = false
    } else if (val === false) {
      // user explicitly disabled this feature
      ;(result as Record<string, unknown>)[key] = false
    } else if (typeof val === 'object' && !Array.isArray(val) && val !== null) {
      const baseVal = (base as Record<string, unknown>)[key]
      if (typeof baseVal === 'object' && baseVal !== null) {
        ;(result as Record<string, unknown>)[key] = {
          ...(baseVal as object),
          ...(val as object),
        }
      } else {
        ;(result as Record<string, unknown>)[key] = val
      }
    } else {
      ;(result as Record<string, unknown>)[key] = val
    }
  }

  return result
}

// ─── Config Loader (reads exis.config.ts at runtime) ───────────────────────
// ─── Config Loader (reads exis.config.ts at runtime) ───────────────────────
import { pathToFileURL } from 'node:url'
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_SERVER,
  PHASE_TEST,
} from '../config/constants'

export async function loadConfig(
  cwd: string = process.cwd()
): Promise<ResolvedConfig> {
  const isProd = process.env.NODE_ENV === 'production'
  const candidates = isProd
    ? [
        path.join(cwd, '.exis', 'server', 'exis.config.js'),
        path.join(cwd, 'dist', 'exis.config.js'),
        path.join(cwd, 'exis.config.js'),
        path.join(cwd, 'exis.config.ts'),
      ]
    : [
        path.join(cwd, 'exis.config.ts'),
        path.join(cwd, 'exis.config.js'),
        path.join(cwd, '.exis', 'server', 'exis.config.js'),
        path.join(cwd, 'dist', 'exis.config.js'),
      ]

  async function fileExists(p: string): Promise<boolean> {
    try {
      await fs.promises.access(p)
      return true
    } catch {
      return false
    }
  }

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      try {
        // use Function to bypass TypeScript's import() -> require() transpilation in CommonJS
        const dynamicImport = new Function(
          'specifier',
          'return import(specifier)'
        )
        const mod = await dynamicImport(pathToFileURL(candidate).href)
        const userConfigRaw = mod.default ?? mod
        let userConfig: ExisConfig

        if (typeof userConfigRaw === 'function') {
          const phase =
            process.env.NODE_ENV === 'test'
              ? PHASE_TEST
              : process.env.NODE_ENV === 'production'
                ? PHASE_PRODUCTION_SERVER
                : PHASE_DEVELOPMENT_SERVER
          userConfig = await userConfigRaw(phase, { defaultConfig })
        } else {
          userConfig = userConfigRaw
        }

        if (typeof userConfig !== 'object' || userConfig === null) {
          console.warn(
            '\x1b[33m[Exis Warning]\x1b[0m Invalid config file — expected an object. Using defaults.'
          )
          return defaultConfig
        }

        return mergeConfig(defaultConfig, userConfig)
      } catch (err: any) {
        if (err?.code === 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG') {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require(candidate)
            const userConfigRaw = mod.default ?? mod
            let userConfig: ExisConfig

            if (typeof userConfigRaw === 'function') {
              const phase =
                process.env.NODE_ENV === 'test'
                  ? PHASE_TEST
                  : process.env.NODE_ENV === 'production'
                    ? PHASE_PRODUCTION_SERVER
                    : PHASE_DEVELOPMENT_SERVER
              userConfig = await userConfigRaw(phase, { defaultConfig })
            } else {
              userConfig = userConfigRaw
            }
            return mergeConfig(defaultConfig, userConfig)
          } catch {
            // fallback failed, continue to standard error logging
          }
        }
        console.warn(`[Exis] Failed to load config from ${candidate}:`, err)
      }
    }
  }

  return defaultConfig
}
