import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { App } from '../../server/app'
import { getFilesRecursively, scanDirectory } from './fs-scanner'

export interface CronFileEntry {
  filePath: string
  module: any
}

/**
 * Discovers and mounts all cron jobs from dedicated directories (e.g. `src/cron/`)
 * and single-file/colocated cron definitions (e.g. `src/http/cron.ts`).
 */
export async function mountCronJobs(
  root: string,
  app: App,
  allApiDirs?: string[]
): Promise<void> {
  const cronFiles: string[] = []

  // 1. Scan dedicated src/cron and .exis/server/src/cron directories (all files are cron jobs)
  const dedicatedCronDirs = [
    path.join(root, '.exis', 'server', 'src', 'cron'),
    path.join(root, '.exis', 'src', 'cron'),
    path.join(root, 'src', 'cron'),
  ]

  for (const dir of dedicatedCronDirs) {
    try {
      const stat = await fs.stat(dir)
      if (stat.isDirectory()) {
        const files = await getFilesRecursively(dir)
        for (const file of files) {
          if (!cronFiles.includes(file)) {
            cronFiles.push(file)
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Scan single-file and colocated cron files in src/http (e.g. src/http/cron.ts)
  const httpDirs =
    allApiDirs && allApiDirs.length > 0
      ? allApiDirs
      : [
          path.join(root, '.exis', 'server', 'src', 'http'),
          path.join(root, '.exis', 'src', 'http'),
          path.join(root, 'src', 'http'),
        ]

  for (const dir of httpDirs) {
    try {
      const stat = await fs.stat(dir).catch(() => null)
      if (!stat || !stat.isDirectory()) continue

      const scan = await scanDirectory(dir)
      for (const { filePath } of scan) {
        const baseName = path.basename(filePath)
        if (
          baseName === 'cron.ts' ||
          baseName === 'cron.js' ||
          baseName === 'cron.mjs' ||
          baseName === 'cron.cjs'
        ) {
          if (!cronFiles.includes(filePath)) {
            cronFiles.push(filePath)
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const entries: CronFileEntry[] = []

  for (const file of cronFiles) {
    try {
      const url =
        process.env.VITEST || process.env.NODE_ENV === 'test'
          ? pathToFileURL(file).href
          : pathToFileURL(file).href + '?t=' + Date.now()

      let mod: any
      try {
        if (process.env.VITEST || process.env.NODE_ENV === 'test') {
          mod = await import(url)
        } else {
          const dynamicImport = new Function(
            'specifier',
            'return import(specifier)'
          )
          mod = await dynamicImport(url)
        }
      } catch {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        mod = require(file)
      }
      entries.push({ filePath: file, module: mod })
    } catch (err: any) {
      app.log.error(
        { err: err.message, file },
        `Failed to load cron file: ${file}`
      )
    }
  }

  mountCronJobsFromEntries(entries, app)
}

/**
 * Mounts cron jobs from pre-loaded module entries (used by both filesystem discovery and manifest boot).
 */
export function mountCronJobsFromEntries(
  entries: CronFileEntry[],
  app: App
): void {
  const CRON_REGISTRY = Symbol.for('exisjs:cron_jobs')
  const registeredCronEntities = new Set<any>()

  for (const { filePath: file, module: mod } of entries) {
    try {
      const candidateExports: { key: string; value: any }[] = []

      const unwrapped =
        mod && mod.default && mod.default.default
          ? mod.default.default
          : mod && mod.default
            ? mod.default
            : mod

      if (unwrapped) {
        candidateExports.push({ key: 'default', value: unwrapped })
      }

      if (mod && typeof mod === 'object' && !mod.__isExisCron) {
        for (const [key, value] of Object.entries(mod)) {
          if (key !== 'default' && key !== '__esModule') {
            candidateExports.push({ key, value })
          }
        }
      }

      const fileBaseName = path.basename(file).replace(/\.[jmt]s$/, '')

      for (const { key, value } of candidateExports) {
        if (!value || registeredCronEntities.has(value)) continue

        // Handle array of cron jobs (e.g. export default [job1, job2])
        const items = Array.isArray(value) ? value : [value]

        for (const item of items) {
          if (!item || registeredCronEntities.has(item)) continue

          // 1. Functional Cron Definition
          if (item.__isExisCron) {
            registeredCronEntities.add(item)
            const jobName =
              item.options.name ||
              (key === 'default' ? fileBaseName : `${fileBaseName}_${key}`)
            app.cron.schedule({
              ...item.options,
              name: jobName,
            })
            app.log.info({ file }, `Mounted cron job "${jobName}" from ${file}`)
            continue
          }

          // 2. Class-Based Decorated Cron
          const targetClass =
            typeof item === 'function' && item.prototype?.[CRON_REGISTRY]
              ? item
              : null

          if (targetClass) {
            registeredCronEntities.add(targetClass)
            let instance: any
            try {
              instance = app.container.resolve(targetClass)
            } catch {
              instance = null
            }
            if (!instance) {
              try {
                instance = app.container.instantiateClass(targetClass)
              } catch {
                instance = new targetClass()
              }
            }

            const decoratedJobs = targetClass.prototype[CRON_REGISTRY]
            if (Array.isArray(decoratedJobs)) {
              for (const jobMeta of decoratedJobs) {
                const jobName =
                  jobMeta.options.name ||
                  `${targetClass.name}.${jobMeta.methodName}`
                app.cron.schedule({
                  ...jobMeta.options,
                  name: jobName,
                  run: (instance as any)[jobMeta.methodName].bind(instance),
                })
                app.log.info(
                  { file },
                  `Mounted OOP cron job "${jobName}" from ${file}`
                )
              }
            }
          }
        }
      }
    } catch (err: any) {
      app.log.error(
        { err: err.message, file },
        `Failed to load cron file: ${file}`
      )
    }
  }
}
