import path from 'node:path'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { App } from '../../server/app'
import { loadConfig } from '../../utils/config'

export async function precompileSerializers(
  cwd: string,
  outDir: string
): Promise<void> {
  const appPath = path.join(cwd, outDir, 'src', 'http', 'server.js')
  const altAppPath = path.join(cwd, outDir, 'http', 'server.js')

  let entry = appPath
  try {
    await fs.stat(appPath)
  } catch {
    try {
      await fs.stat(altAppPath)
      entry = altAppPath
    } catch {
      return
    }
  }

  process.env.NODE_ENV = 'production'
  await loadConfig(cwd)

  const dynamicImport = new Function('specifier', 'return import(specifier)')
  const mod = await dynamicImport(pathToFileURL(entry).href)
  const isApp = (obj: any): boolean =>
    !!(obj && typeof obj === 'object' && 'getRoutes' in obj)

  const appExport = Object.values(mod).find(isApp)
  const app = (isApp(mod.default) ? mod.default : appExport) as App | undefined

  if (!app) return
  if (typeof app.create === 'function') {
    await app.create()
  }

  const routes = app.getRoutes()
  if (!routes || routes.length === 0) return

  let code = `// Pre-compiled Serializers\n`
  code += `import fastJsonStringify from 'fast-json-stringify'\n\n`
  code += `export const serializers = {\n`

  let hasSerializers = false
  for (const route of routes) {
    if (route.schema && route.schema.response) {
      const isZodLike = typeof route.schema.response.parse === 'function'
      if (!isZodLike) {
        // Only JSON Schema can be compiled with fast-json-stringify
        code += `  '${route.method}:${route.path}': fastJsonStringify(${JSON.stringify(route.schema.response)}),\n`
        hasSerializers = true
      }
    }
  }

  code += `}\n`

  if (hasSerializers) {
    const aotDir = path.join(cwd, '.exis', 'server')
    try {
      await fs.mkdir(aotDir, { recursive: true })
    } catch {
      /* noop */
    }
    await fs.writeFile(path.join(aotDir, '_serializers.js'), code, 'utf8')
  }
}
