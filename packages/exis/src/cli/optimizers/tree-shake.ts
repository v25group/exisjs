import path from 'node:path'
import fs from 'node:fs/promises'

export async function treeShakeMiddleware(
  cwd: string,
  outDir: string
): Promise<void> {
  const serverDir = path.join(cwd, outDir)

  // A simplistic tree shaker that scans .js files for middleware usage
  // In a real bundler (esbuild), this happens at the AST level.
  // Here we just want to prove the concept and generate a report.

  const allFiles: string[] = []

  async function scan(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await scan(full)
        } else if (entry.name.endsWith('.js')) {
          allFiles.push(full)
        }
      }
    } catch {
      /* noop */
    }
  }

  await scan(serverDir)

  const usedMiddleware = new Set<string>()

  for (const file of allFiles) {
    const content = await fs.readFile(file, 'utf8')

    // Look for import { cors, helmet } from 'exisjs/middleware'
    // or require('exisjs/middleware')
    // This regex is rudimentary, but enough for a demo report
    const matches = content.matchAll(/exisjs\/middleware['"]\s*\)?(.*)/g)
    for (const _match of matches) {
      if (content.includes('cors')) usedMiddleware.add('cors')
      if (content.includes('helmet')) usedMiddleware.add('helmet')
      if (content.includes('compression')) usedMiddleware.add('compression')
      if (content.includes('ipFilter')) usedMiddleware.add('ipFilter')
      if (content.includes('rateLimit')) usedMiddleware.add('rateLimit')
    }
  }

  let report = `// Tree-Shaking Report\n`
  report += `// Used middlewares: ${Array.from(usedMiddleware).join(', ') || 'none detected'}\n`

  const aotDir = path.join(cwd, '.exis', 'server')
  try {
    await fs.mkdir(aotDir, { recursive: true })
  } catch {
    /* noop */
  }

  await fs.writeFile(
    path.join(aotDir, '_tree_shake_report.txt'),
    report,
    'utf8'
  )
}
