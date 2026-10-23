import { pathToFileURL } from 'node:url'

// A real import(): tsc turns `import()` into require() for CommonJS, which
// loads a second copy of every module a test or the app imports as ESM
const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<any>

/** Imports a route or boundary file, with a cache-busting query outside tests. */
export async function importFile(filePath: string): Promise<any> {
  const isTest = process.env.VITEST || process.env.NODE_ENV === 'test'
  const url = pathToFileURL(filePath).href + (isTest ? '' : '?t=' + Date.now())
  try {
    return await nativeImport(url)
  } catch (err: any) {
    // Only a runtime with no ESM loader for .ts lands here legitimately; any
    // other error is the file's own and must not be hidden behind require()
    if (err?.code !== 'ERR_UNKNOWN_FILE_EXTENSION') throw err
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(filePath)
  }
}
