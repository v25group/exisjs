import path from 'node:path'
import fs from 'node:fs'

interface AliasMapping {
  /** The alias prefix without the wildcard, e.g. "@/" */
  prefix: string
  /** The absolute target directory the alias maps to */
  targetDir: string
}

/**
 * Parses tsconfig.json and extracts path alias mappings.
 * Supports patterns like: "@/*": ["./src/*"]
 */
function parseAliases(cwd: string): AliasMapping[] {
  const tsconfigPath = path.join(cwd, 'tsconfig.json')
  if (!fs.existsSync(tsconfigPath)) return []

  let tsconfig: any
  try {
    // Strip comments from tsconfig (JSON with comments)
    const raw = fs.readFileSync(tsconfigPath, 'utf-8')
    const tokenizer = /"([^"\\]|\\.)*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g
    const stripped = raw.replace(tokenizer, (match, stringContent, comment) => {
      if (comment) return ''
      return match
    })
    tsconfig = JSON.parse(stripped)
  } catch {
    return []
  }

  const paths = tsconfig?.compilerOptions?.paths
  if (!paths || typeof paths !== 'object') return []

  const baseUrl = tsconfig?.compilerOptions?.baseUrl || '.'
  const baseDir = path.resolve(cwd, baseUrl)

  const aliases: AliasMapping[] = []

  for (const [aliasPattern, targets] of Object.entries(paths)) {
    // We only handle wildcard patterns like "@/*" -> ["./src/*"]
    if (!aliasPattern.endsWith('/*')) continue
    const targetArray = targets as string[]
    if (!targetArray?.length) continue

    const firstTarget = targetArray[0]
    if (!firstTarget.endsWith('/*')) continue

    const prefix = aliasPattern.slice(0, -1) // "@/*" -> "@/"
    const targetRelative = firstTarget.slice(0, -1) // "./src/*" -> "./src/"
    const targetDir = path.resolve(baseDir, targetRelative)

    aliases.push({ prefix, targetDir })
  }

  return aliases
}

/**
 * Collects all .js and .mjs files recursively from a directory.
 */
function collectJsFiles(dir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(fullPath))
    } else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
      results.push(fullPath)
    }
  }
  return results
}

/**
 * Computes the correct relative path from a source file to a target file.
 * Always uses forward slashes and ensures a leading "./" or "../".
 */
function computeRelativePath(fromFile: string, toFile: string): string {
  const fromDir = path.dirname(fromFile)
  let rel = path.relative(fromDir, toFile).replace(/\\/g, '/')

  // Ensure it starts with ./ or ../
  if (!rel.startsWith('.')) {
    rel = './' + rel
  }

  return rel
}

/**
 * Resolves a single alias import specifier to a relative path.
 * Returns null if the specifier doesn't match any alias.
 */
function resolveSpecifier(
  specifier: string,
  sourceFile: string,
  aliases: AliasMapping[],
  outDir: string,
  cwd: string
): string | null {
  for (const alias of aliases) {
    if (specifier.startsWith(alias.prefix)) {
      const remainder = specifier.slice(alias.prefix.length)
      const targetSourcePath = path.join(alias.targetDir, remainder)
      const relFromCwd = path.relative(cwd, targetSourcePath)
      const targetOutputPath = path.join(outDir, relFromCwd)

      let resolvedTarget = targetOutputPath
      if (!path.extname(resolvedTarget)) {
        resolvedTarget = resolvedTarget + '.js'
      }
      if (
        fs.existsSync(targetOutputPath) &&
        fs.statSync(targetOutputPath).isDirectory()
      ) {
        resolvedTarget = path.join(targetOutputPath, 'index.js')
      }
      return computeRelativePath(sourceFile, resolvedTarget)
    }
  }

  // Also fix missing extensions for relative imports
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    if (!path.extname(specifier)) {
      const targetAbs = path.resolve(path.dirname(sourceFile), specifier)
      if (fs.existsSync(targetAbs) && fs.statSync(targetAbs).isDirectory()) {
        return specifier.endsWith('/')
          ? specifier + 'index.js'
          : specifier + '/index.js'
      }
      return specifier + '.js'
    }
  }

  return null
}

/**
 * The regex that matches import/export/require statements with string specifiers.
 *
 * Matches:
 * - import ... from '@/...'
 * - import ... from "@/..."
 * - export ... from '@/...'
 * - export ... from "@/..."
 * - import('@/...')
 * - require('@/...')
 */
const IMPORT_REGEX =
  /(?:(?:import|export)\s+.*?\s+from\s+|(?:import|require)\s*\(\s*)(['"])([^'"]+)\1/g

/**
 * Rewrites all alias imports in a single file's content.
 */
function rewriteFileContent(
  content: string,
  sourceFile: string,
  aliases: AliasMapping[],
  outDir: string,
  cwd: string
): string {
  return content.replace(IMPORT_REGEX, (match, quote, specifier) => {
    const resolved = resolveSpecifier(
      specifier,
      sourceFile,
      aliases,
      outDir,
      cwd
    )
    if (resolved) {
      return match.replace(
        `${quote}${specifier}${quote}`,
        `${quote}${resolved}${quote}`
      )
    }
    return match
  })
}

/**
 * Main entry point: resolves all path aliases in the build output.
 * Called by the build command after tsc compilation.
 */
export async function resolvePathAliases(
  cwd: string,
  outDir: string
): Promise<number> {
  const aliases = parseAliases(cwd)
  if (aliases.length === 0) return 0

  const absoluteOutDir = path.resolve(cwd, outDir)
  const files = collectJsFiles(absoluteOutDir)

  let rewrittenCount = 0

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8')

    // Quick check: does this file even contain any alias prefix?
    const hasAlias = aliases.some((a) => content.includes(a.prefix))
    if (!hasAlias) continue

    const rewritten = rewriteFileContent(
      content,
      file,
      aliases,
      absoluteOutDir,
      cwd
    )
    if (rewritten !== content) {
      fs.writeFileSync(file, rewritten, 'utf-8')
      rewrittenCount++
    }
  }

  return rewrittenCount
}
