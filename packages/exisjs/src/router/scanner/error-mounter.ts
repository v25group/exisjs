import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { App } from '../../server/app'

/**
 * Discovers and mounts the global error handler for a given HTTP directory.
 */
export async function mountErrorHandler(dir: string, app: App): Promise<void> {
  const candidateFiles = [
    path.join(dir, 'error.ts'),
    path.join(dir, 'error.js'),
    path.join(dir, 'error.mjs'),
    path.join(dir, 'error.cjs'),
  ]

  let errorFile: string | null = null
  for (const file of candidateFiles) {
    try {
      const stat = await fs.stat(file)
      if (stat.isFile()) {
        errorFile = file
        break
      }
    } catch {
      // ignore
    }
  }

  if (!errorFile) {
    try {
      const dirFiles = await fs.readdir(dir).catch(() => [])
      const namedError = dirFiles.find((f: string) =>
        /\.error\.[jmt]s$/.test(f)
      )
      if (namedError) {
        errorFile = path.join(dir, namedError)
      }
    } catch {
      // ignore
    }
  }

  if (!errorFile) return

  try {
    const url =
      process.env.VITEST || process.env.NODE_ENV === 'test'
        ? pathToFileURL(errorFile).href
        : pathToFileURL(errorFile).href + '?t=' + Date.now()

    let mod: any
    if (process.env.VITEST || process.env.NODE_ENV === 'test') {
      mod = await import(url)
    } else {
      const dynamicImport = new Function(
        'specifier',
        'return import(specifier)'
      )
      mod = await dynamicImport(url)
    }

    mountErrorHandlerFromModule(mod, app, errorFile)
  } catch (err) {
    app.log.error(
      { err, file: errorFile },
      `Failed to load error handler file: ${errorFile}`
    )
  }
}

/**
 * Mounts a global error handler from an already loaded module export.
 * Supports:
 * - OOP class error handlers with DI resolution (`onError`, `catch`, `handle`, `handleError`)
 * - Object-based error handlers
 * - Functional error handler callbacks `(err, req, res, next)`
 */
export function mountErrorHandlerFromModule(
  mod: any,
  app: App,
  errorFile = 'error.ts'
): void {
  try {
    const unwrapped =
      mod && mod.default && mod.default.default
        ? mod.default.default
        : mod && mod.default
          ? mod.default
          : mod

    let handler: any = null

    const isClass = (fn: any): boolean => {
      if (typeof fn !== 'function') return false
      if (
        fn.prototype &&
        (typeof fn.prototype.onError === 'function' ||
          typeof fn.prototype.catch === 'function' ||
          typeof fn.prototype.handle === 'function' ||
          typeof fn.prototype.handleError === 'function')
      ) {
        return true
      }
      return /^class\s/.test(Function.prototype.toString.call(fn))
    }

    const targetClass = isClass(unwrapped)
      ? unwrapped
      : isClass(mod?.GlobalErrorHandler)
        ? mod.GlobalErrorHandler
        : isClass(mod?.ErrorHandler)
          ? mod.ErrorHandler
          : null

    if (targetClass) {
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

      const method =
        instance.onError ||
        instance.catch ||
        instance.handle ||
        instance.handleError

      if (typeof method === 'function') {
        handler = (err: any, req: any, res: any, next?: any) => {
          if (method.length === 2 && instance.catch === method) {
            return method.call(instance, err, { req, res, next })
          }
          return method.call(instance, err, req, res, next)
        }
      }
    } else if (
      unwrapped &&
      typeof unwrapped === 'object' &&
      (typeof unwrapped.onError === 'function' ||
        typeof unwrapped.catch === 'function' ||
        typeof unwrapped.handle === 'function' ||
        typeof unwrapped.handleError === 'function')
    ) {
      const method =
        unwrapped.onError ||
        unwrapped.catch ||
        unwrapped.handle ||
        unwrapped.handleError
      handler = (err: any, req: any, res: any, next?: any) => {
        if (method.length === 2 && unwrapped.catch === method) {
          return method.call(unwrapped, err, { req, res, next })
        }
        return method.call(unwrapped, err, req, res, next)
      }
    }

    if (!handler) {
      handler =
        mod.onError ||
        (unwrapped && unwrapped.onError) ||
        (typeof unwrapped === 'function' && !isClass(unwrapped)
          ? unwrapped
          : null) ||
        mod.errorHandler ||
        mod.handleError
    }

    if (typeof handler === 'function') {
      if (handler.length === 4) {
        app.use(handler)
      } else {
        app.onError(handler)
      }
      app.log.info(
        { file: errorFile },
        'Mounted global error handler from error.ts'
      )
    }
  } catch (err) {
    app.log.error(
      { err, file: errorFile },
      `Failed to load error handler file: ${errorFile}`
    )
  }
}
