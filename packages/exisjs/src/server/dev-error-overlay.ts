import fs from 'node:fs'

const c = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  bgRed: '\x1b[41m',
}

interface ParsedError {
  message: string
  file?: string
  line?: number
  column?: number
}

function parseErrorLocation(err: Error): ParsedError {
  const result: ParsedError = { message: err.message }

  if (!err.stack) return result

  // Match common stack trace patterns:
  // at Object.<anonymous> (/path/to/file.ts:10:5)
  // /path/to/file.ts:10:5
  const stackLines = err.stack.split('\n')

  for (const line of stackLines) {
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
    if (match2 && !match2[1].includes('node_modules')) {
      result.file = match2[1]
      result.line = parseInt(match2[2], 10)
      result.column = parseInt(match2[3], 10)
      break
    }

    // Pattern 3: bare file:line:col (TypeScript compile errors)
    const match3 = line.match(/^(.+\.tsx?):(\d+):(\d+)/)
    if (match3) {
      result.file = match3[1]
      result.line = parseInt(match3[2], 10)
      result.column = parseInt(match3[3], 10)
      break
    }
  }

  return result
}

function buildCodeFrame(
  filePath: string,
  errorLine: number,
  contextLines = 3
): string {
  try {
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
      } else {
        output.push(`  ${c.gray}  ${lineNum} | ${lines[i]}${c.reset}`)
      }
    }

    return output.join('\n')
  } catch {
    return ''
  }
}

export function formatDevError(err: Error, routeFile?: string): void {
  const parsed = parseErrorLocation(err)
  const file = routeFile || parsed.file || 'unknown'
  const lineInfo = parsed.line
    ? `:${parsed.line}${parsed.column ? ':' + parsed.column : ''}`
    : ''

  const width = 60
  const border = '─'.repeat(width)

  console.log('')
  console.log(`  ${c.red}${c.bold}✕ Build Error${c.reset}`)
  console.log(`  ${c.gray}${border}${c.reset}`)
  console.log(`  ${c.cyan}${file}${c.dim}${lineInfo}${c.reset}`)
  console.log('')

  // Code frame
  if (parsed.file && parsed.line) {
    const frame = buildCodeFrame(parsed.file, parsed.line)
    if (frame) {
      console.log(frame)
      console.log('')
    }
  }

  console.log(`  ${c.red}${err.message}${c.reset}`)
  console.log(`  ${c.gray}${border}${c.reset}`)
  console.log('')
}

export function devErrorResponse(err: Error, routeFile?: string): object {
  const parsed = parseErrorLocation(err)

  return {
    success: false,
    error: {
      code: 'DEV_ERROR',
      message: err.message,
      file: routeFile || parsed.file,
      line: parsed.line,
      column: parsed.column,
    },
  }
}
