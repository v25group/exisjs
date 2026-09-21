import fs from 'node:fs'
import path from 'node:path'

const c = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  magenta: '\x1b[35m',
  purple: '\x1b[38;2;160;70;255m',
}

export interface ParsedError {
  message: string
  title: string
  file?: string
  line?: number
  column?: number
  hint?: string | null
  cleanStack?: string[]
  codeFrame?: string
}

const INTERNAL_STACK_PATTERNS = [
  /node:internal\//i,
  /node:events/i,
  /node:process/i,
  /node:async_hooks/i,
  /node_modules\/tsx\//i,
  /node_modules\/commander\//i,
  /node_modules\/pino/i,
  /packages\/exisjs\/dist\//i,
  /node_modules\/exisjs\/dist\//i,
  /node_modules\/@exisjs\//i,
  /node_modules\/@swc\//i,
  /at async (?:Promise\.all|runHandlers|startServer)/i,
]

/**
 * Strips internal framework and runtime frames from a stack trace,
 * leaving only user application code frames.
 */
export function stripInternalStackFrames(stack?: string): string[] {
  if (!stack) return []
  const lines = stack.split('\n').map((l) => l.trim())
  const userFrames: string[] = []

  for (const line of lines) {
    if (!line.startsWith('at ')) continue

    const isInternal = INTERNAL_STACK_PATTERNS.some((pattern) =>
      pattern.test(line)
    )

    if (!isInternal) {
      userFrames.push(line)
    }
  }

  return userFrames
}

/**
 * Intelligently classifies errors into human-readable, domain-specific titles.
 */
export function categorizeError(err: Error): string {
  const msg = (err.message || '').toLowerCase()
  const name = err.name || ''

  if (
    msg.includes('environment variable') ||
    msg.includes('missing_env_var') ||
    msg.includes('tex.env') ||
    msg.includes('.env')
  ) {
    return 'Environment Configuration Error'
  }

  if (
    msg.includes('tex.') ||
    msg.includes('validation') ||
    msg.includes('expects tex.') ||
    msg.includes('zod') ||
    name === 'ValidatorError' ||
    name === 'ValidationError'
  ) {
    return 'Validation Schema Error'
  }

  if (
    msg.includes('route') ||
    msg.includes('radixtree') ||
    msg.includes('duplicate route') ||
    msg.includes('controller') ||
    msg.includes('@get') ||
    msg.includes('@post') ||
    msg.includes('@put') ||
    msg.includes('@delete')
  ) {
    return 'Route Configuration Error'
  }

  if (
    msg.includes('cannot resolve token') ||
    msg.includes('circular dependency') ||
    msg.includes('provider') ||
    msg.includes('dependency injection') ||
    msg.includes('ioc')
  ) {
    return 'Dependency Injection Error'
  }

  if (
    msg.includes('boundary') ||
    msg.includes('beforehandle') ||
    msg.includes('afterhandle') ||
    msg.includes('middleware')
  ) {
    return 'Boundary & Middleware Error'
  }

  if (
    name === 'SyntaxError' ||
    msg.includes('unexpected token') ||
    msg.includes('syntaxerror')
  ) {
    return 'Syntax Error'
  }

  if (
    msg.includes('cannot find module') ||
    msg.includes('module_not_found') ||
    msg.includes('err_module_not_found')
  ) {
    return 'Module Import Error'
  }

  if (msg.includes('eaddrinuse') || msg.includes('address already in use')) {
    return 'Port Conflict Error'
  }

  return 'Runtime Exception'
}

/**
 * Generates an actionable, developer-friendly hint based on common coding mistakes.
 */
export function generateErrorHint(err: Error): string | null {
  const msg = err.message || ''

  // Missing required environment variable
  if (
    msg.toLowerCase().includes('missing') &&
    msg.toLowerCase().includes('environment variable')
  ) {
    const varMatch =
      msg.match(/["']([A-Z0-9_]+)["']/i) || msg.match(/\b([A-Z0-9_]{3,})\b/)
    const varName = varMatch ? varMatch[1] : 'the variable'
    return `Add ${varName} to your .env file or declare a default value using tex.string({ default: '...' }) in src/config/env.ts.`
  }

  // Schema expects enum / object but received undefined
  if (
    msg.includes('expects tex.enum') ||
    (msg.includes('expects') && msg.includes('received undefined'))
  ) {
    return 'Did you forget to provide a default value, or mark the field optional via .optional()?'
  }

  // Cannot find module
  if (
    msg.includes('Cannot find module') ||
    msg.includes('ERR_MODULE_NOT_FOUND')
  ) {
    return 'Check for typos in the import path or ensure the dependency is installed in package.json.'
  }

  // Missing decorator / return
  if (msg.toLowerCase().includes('route handler must be a function')) {
    return 'Verify that your controller method is decorated with @Get(), @Post(), etc., and has a valid handler function.'
  }

  // DI Resolution failure
  if (
    msg.toLowerCase().includes('cannot resolve token') ||
    msg.toLowerCase().includes('no provider found')
  ) {
    return 'Ensure the service is decorated with @Injectable() or registered in providers array in your boundary/server.'
  }

  // Port conflict
  if (msg.includes('EADDRINUSE') || msg.includes('address already in use')) {
    return "Another process is already using this port. Stop the other process or run 'exis dev -p <new-port>'."
  }

  // Generic hint if none matched
  return null
}

export function parseErrorLocation(
  err: Error,
  fallbackFile?: string
): ParsedError {
  const title = categorizeError(err)
  const hint = generateErrorHint(err)
  const cleanStack = stripInternalStackFrames(err.stack)
  const result: ParsedError = {
    message: err.message || 'An unexpected error occurred.',
    title,
    hint,
    cleanStack,
    file: fallbackFile,
  }

  if (!err.stack) return result

  const stackLines = err.stack.split('\n')

  for (const line of stackLines) {
    // Check if line is from internal node_modules/exisjs or node:internal
    const isInternal = INTERNAL_STACK_PATTERNS.some((p) => p.test(line))
    if (isInternal && !result.file) continue

    // Pattern 1: (file:line:col)
    const match1 = line.match(/\((.+):(\d+):(\d+)\)/)
    if (match1) {
      result.file = match1[1]
      result.line = parseInt(match1[2], 10)
      result.column = parseInt(match1[3], 10)
      break
    }

    // Pattern 2: at file:line:col (no parens)
    const match2 = line.match(/at\s+(.+):(\d+):(\d+)/)
    if (match2) {
      result.file = match2[1]
      result.line = parseInt(match2[2], 10)
      result.column = parseInt(match2[3], 10)
      break
    }

    // Pattern 3: bare file:line:col (TypeScript / esbuild compile errors)
    const match3 = line.match(/^(.+\.tsx?):(\d+):(\d+)/)
    if (match3) {
      result.file = match3[1]
      result.line = parseInt(match3[2], 10)
      result.column = parseInt(match3[3], 10)
      break
    }
  }

  if (fallbackFile && (!result.file || result.file === 'unknown')) {
    result.file = fallbackFile
  }

  return result
}

export function buildCodeFrame(
  filePath: string,
  errorLine: number,
  errorCol?: number,
  contextLines = 2
): string {
  try {
    if (!fs.existsSync(filePath)) return ''
    const source = fs.readFileSync(filePath, 'utf-8')
    const lines = source.split('\n')
    const start = Math.max(0, errorLine - contextLines - 1)
    const end = Math.min(lines.length, errorLine + contextLines)

    const gutterWidth = String(end).length
    const output: string[] = []

    for (let i = start; i < end; i++) {
      const lineNum = String(i + 1).padStart(gutterWidth, ' ')
      const isErrorLine = i + 1 === errorLine

      if (isErrorLine) {
        output.push(`  ${c.red}${c.bold}> ${lineNum} | ${lines[i]}${c.reset}`)
        if (errorCol && errorCol > 0) {
          const pointerPadding = ' '.repeat(gutterWidth + errorCol + 2)
          output.push(`  ${c.red}${c.bold}  | ${pointerPadding}^${c.reset}`)
        }
      } else {
        output.push(`  ${c.gray}  ${lineNum} | ${lines[i]}${c.reset}`)
      }
    }

    return output.join('\n')
  } catch {
    return ''
  }
}

/**
 * Formats a clean, human-readable terminal error envelope for developers.
 */
export function renderDevErrorToString(
  err: Error,
  optionsOrFile?: string | { routeFile?: string; title?: string }
): string {
  const fallbackFile =
    typeof optionsOrFile === 'string' ? optionsOrFile : optionsOrFile?.routeFile
  const customTitle =
    typeof optionsOrFile === 'object' ? optionsOrFile.title : undefined

  const parsed = parseErrorLocation(err, fallbackFile)
  const title = customTitle || parsed.title

  // Format relative file path for clean reading
  let displayFile = parsed.file || fallbackFile || 'unknown'
  try {
    if (displayFile && path.isAbsolute(displayFile)) {
      displayFile = path
        .relative(process.cwd(), displayFile)
        .replace(/\\/g, '/')
    }
  } catch {
    /* keep as is */
  }

  const lineInfo = parsed.line
    ? `:${parsed.line}${parsed.column ? ':' + parsed.column : ''}`
    : ''

  const output: string[] = []
  output.push('')
  output.push(
    `  ${c.red}${c.bold}✗ [exis] ${title}${c.reset}${displayFile !== 'unknown' ? ` in ${c.cyan}${displayFile}${lineInfo}${c.reset}` : ''}`
  )
  output.push(`    ${err.message || 'An error occurred during execution.'}`)

  // Render code frame if file and line are known
  if (parsed.file && parsed.line) {
    const frame = buildCodeFrame(parsed.file, parsed.line, parsed.column)
    if (frame) {
      output.push('')
      output.push(frame)
    }
  }

  // Render actionable hint if available
  const hint = parsed.hint
  if (hint) {
    output.push('')
    output.push(
      `    ${c.yellow}${c.bold}Hint:${c.reset} ${c.yellow}${hint}${c.reset}`
    )
  }

  output.push('')
  return output.join('\n')
}

/**
 * Prints a clean error envelope directly to terminal.
 */
export function formatDevError(
  err: Error,
  optionsOrFile?: string | { routeFile?: string; title?: string }
): void {
  const formatted = renderDevErrorToString(err, optionsOrFile)
  console.error(formatted)
}

export function formatCliError(err: Error, file?: string): void {
  formatDevError(err, file)
}

export function devErrorResponse(err: Error, routeFile?: string): object {
  const parsed = parseErrorLocation(err, routeFile)

  return {
    success: false,
    error: {
      code: 'DEV_ERROR',
      title: parsed.title,
      message: err.message,
      file: routeFile || parsed.file,
      line: parsed.line,
      column: parsed.column,
      hint: parsed.hint,
    },
  }
}
