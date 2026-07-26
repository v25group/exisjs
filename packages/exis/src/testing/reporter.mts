/**
 * Custom Jest/Vitest-like Test Reporter for ExisJS
 *
 * Consumes the async iterable of TestEvent objects emitted by Node's
 * built-in test runner (node:test) and renders Jest-style terminal output.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── Types ──────────────────────────────────────────────────────────────────
// Node's test runner doesn't ship reporter event types, so we declare the
// shape we actually rely on. Keep this in sync with node:test's TestEvent.

interface TestEventDetails {
  duration_ms?: number
  type?: 'suite' | 'test'
  error?: {
    message?: string
    stack?: string
    cause?: { message?: string; stack?: string }
    // node:assert failures carry these for diffing
    expected?: unknown
    actual?: unknown
  }
}

interface TestEventData {
  name: string
  nesting: number
  testNumber?: number
  file?: string
  line?: number
  column?: number
  details?: TestEventDetails
  skip?: string | boolean
  todo?: string | boolean
}

interface TestEvent {
  type:
    | 'test:pass'
    | 'test:fail'
    | 'test:skip'
    | 'test:todo'
    | 'test:diagnostic'
    | 'test:stdout'
    | 'test:stderr'
    | 'test:start'
  data: TestEventData
}

interface FailedTestRecord {
  file: string
  fullName: string
  errMsg: string
  stack: string
}

interface FileData {
  output: string[]
  failed: boolean
  passedCount: number
  failedCount: number
  skippedCount: number
}

// ─── Colors (respects NO_COLOR / non-TTY) ──────────────────────────────────

const supportsColor = !process.env.NO_COLOR && (process.stdout.isTTY ?? false)

function paint(code: string) {
  return supportsColor ? code : ''
}

const GREEN_BG = paint('\x1b[42m\x1b[30m')
const RED_BG = paint('\x1b[41m\x1b[30m')
const GREEN = paint('\x1b[32m')
const RED = paint('\x1b[31m')
const YELLOW = paint('\x1b[33m')
const DIM = paint('\x1b[90m')
const BOLD = paint('\x1b[1m')
const RESET = paint('\x1b[0m')

const CHECK = '√'
const CROSS = '×'
const SKIP = '○'
const TODO = '‼'

const SLOW_TEST_MS = 100 // tests slower than this get a yellow duration flag

// ─── Helpers ────────────────────────────────────────────────────────────────

function relFile(file: string): string {
  const cleaned = file.startsWith('file://') ? fileURLToPath(file) : file
  return path.relative(process.cwd(), cleaned).split(path.sep).join('/')
}

/** Filters a stack trace down to frames that point at user code. */
function cleanStack(stack: string | undefined): string {
  if (!stack) return ''
  return stack
    .split('\n')
    .filter((line) => !/node:internal|node_modules[\\/]/.test(line))
    .slice(0, 6) // cap depth so one failure doesn't dominate the terminal
    .join('\n')
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return ''
  const rounded = Math.round(ms)
  const color = rounded > SLOW_TEST_MS ? YELLOW : DIM
  return ` ${color}(${rounded} ms)${RESET}`
}

// ─── Reporter ───────────────────────────────────────────────────────────────

export default async function* customReporter(
  source: AsyncIterable<TestEvent>
): AsyncGenerator<string> {
  let passedTests = 0
  let failedTests = 0
  let skippedTests = 0
  let totalTests = 0
  let passedSuites = 0
  let failedSuites = 0
  const startTime = Date.now()
  const failures: FailedTestRecord[] = []

  const filesMap = new Map<string, FileData>()
  const getFileData = (file: string): FileData => {
    const absFile = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file)
    const normalized = absFile.replace(/\\/g, '/')
    let fd = filesMap.get(normalized)
    if (!fd) {
      fd = {
        output: [],
        failed: false,
        passedCount: 0,
        failedCount: 0,
        skippedCount: 0,
      }
      filesMap.set(normalized, fd)
    }
    return fd
  }

  try {
    let currentFile = ''
    const printedFiles = new Set<string>()
    for await (const event of source) {
      const { type, data } = event
      if (!data) continue
      const { name, nesting, details, file, skip, todo } = data

      // Track the actual test file since wrapped tests report `index.ts`
      const safeName = name || ''
      const normalizedName = safeName.replace(/\\/g, '/')
      const isFileSuite = ((type as any) === 'test:enqueue' || (type as any) === 'test:start') && (safeName === file || normalizedName === relFile(file || '') || (file && file.replace(/\\/g, '/').endsWith(normalizedName)))
      if (isFileSuite) {
        currentFile = file || safeName
      }
      const activeFile = (file && file.replace(/\\/g, '/').match(/testing\/index\.[mc]?[jt]s/)) ? (currentFile || file) : (file || currentFile)
      
      if (!activeFile) continue

      const fileData = getFileData(activeFile)
      const isSuite = details?.type === 'suite'
      const indent = '  '.repeat(Math.max(nesting, 0))

      // ─── File-level suite completion ─────────────────────────
      const isTopLevelCompletion = (type === 'test:pass' || type === 'test:fail') && nesting === 0
      
      if (isTopLevelCompletion) {
        if (!printedFiles.has(activeFile)) {
          const relPath = relFile(activeFile)
          const badge = fileData.failed
            ? `${RED_BG}${BOLD} FAIL ${RESET}`
            : `${GREEN_BG}${BOLD} PASS ${RESET}`

          yield `\n ${badge} ${DIM}exis${RESET} ${relPath}\n`
          printedFiles.add(activeFile)
          if (fileData.failed) failedSuites++; else passedSuites++;
        }
        for (const line of fileData.output) yield line
        fileData.output.length = 0 // Clear it so it doesn't print twice
        continue
      }

      // ─── Skipped / todo tests ─────────────────────────────────────────────
      if (type === 'test:skip' || skip) {
        fileData.output.push(
          `${indent} ${DIM}${SKIP} ${name} (skipped)${RESET}\n`
        )
        skippedTests++
        totalTests++
        continue
      }

      if (type === 'test:todo' || todo) {
        fileData.output.push(
          `${indent} ${YELLOW}${TODO} ${name} (todo)${RESET}\n`
        )
        skippedTests++
        totalTests++
        continue
      }

      // ─── Suite headers (describe blocks) ──────────────────────────────────
      if (isSuite) {
        if (type === 'test:start') {
          fileData.output.push(`${indent} ${BOLD}${name}${RESET}\n`)
        }
        if (type === 'test:fail') {
          fileData.failed = true
          const err = details?.error
          if (err) {
            const errMsg = err?.message || err?.cause?.message || 'Unknown error'
            const stack = cleanStack(err?.stack || err?.cause?.stack)
            fileData.output.push(`\n${indent}   ${RED}${errMsg}${RESET}\n`)
            if (stack) {
              fileData.output.push(
                stack
                  .split('\n')
                  .map((l) => `${indent}   ${DIM}${l}${RESET}`)
                  .join('\n') + '\n\n'
              )
            }
          }
        }
        continue
      }

      // ─── Console Logs (stdout/stderr) ─────────────────────────────────────
      if (type === 'test:stdout' || type === 'test:stderr') {
        const message = (data as any).message?.trimEnd()
        if (message) {
          const logLines = message.split('\n').map((l: string) => `${indent}   ${DIM}│${RESET} ${l}`)
          fileData.output.push(...logLines, '\n')
        }
        continue
      }

      // ─── Individual tests ──────────────────────────────────────────────────
      if (type === 'test:pass') {
        const timeStr = formatDuration(details?.duration_ms)
        fileData.output.push(
          `${indent} ${GREEN}${CHECK}${RESET} ${DIM}${name}${RESET}${timeStr}\n`
        )
        passedTests++
        totalTests++
        continue
      }

      if (type === 'test:fail') {
        const timeStr = formatDuration(details?.duration_ms)
        fileData.output.push(
          `${indent} ${RED}${CROSS}${RESET} ${RED}${name}${RESET}${timeStr}\n`
        )

        const err = details?.error
        const errMsg = err?.message || err?.cause?.message || 'Unknown error'
        const stack = cleanStack(err?.stack || err?.cause?.stack)

        fileData.output.push(`\n${indent}   ${RED}${errMsg}${RESET}\n`)
        if (stack) {
          fileData.output.push(
            stack
              .split('\n')
              .map((l) => `${indent}   ${DIM}${l}${RESET}`)
              .join('\n') + '\n\n'
          )
        }

        failedTests++
        totalTests++
        fileData.failed = true

        failures.push({
          file: relFile(activeFile),
          fullName: safeName,
          errMsg,
          stack,
        })
      }
    }
  } catch (reporterErr) {
    // Never let the reporter itself crash the test run silently.
    yield `\n${RED}${BOLD}Reporter error:${RESET} ${(reporterErr as Error).message}\n`
  }

  // ─── Failure summary (Vitest/Jest style, scannable at a glance) ───────────
  if (failures.length > 0) {
    yield `\n${BOLD}${RED}Failed Tests ${failures.length}${RESET}\n\n`
    for (const f of failures) {
      yield ` ${RED}${CROSS}${RESET} ${f.file} ${DIM}>${RESET} ${f.fullName}\n`
      yield `   ${DIM}${f.errMsg}${RESET}\n`
    }
    yield '\n'
  }

  // ─── Final summary ──────────────────────────────────────────────────────
  const duration = ((Date.now() - startTime) / 1000).toFixed(3)

  yield `${BOLD}Test Suites:${RESET} `
  if (failedSuites > 0) yield `${RED}${BOLD}${failedSuites} failed${RESET}, `
  yield `${GREEN}${BOLD}${passedSuites} passed${RESET}, ${passedSuites + failedSuites} total\n`

  yield `${BOLD}Tests:      ${RESET} `
  if (failedTests > 0) yield `${RED}${BOLD}${failedTests} failed${RESET}, `
  if (skippedTests > 0) yield `${YELLOW}${skippedTests} skipped${RESET}, `
  yield `${GREEN}${BOLD}${passedTests} passed${RESET}, ${totalTests} total\n`

  yield `${BOLD}Time:       ${RESET} ${duration} s\n\n`

  if (failedTests > 0 || failedSuites > 0) {
    process.exitCode = 1
  }
}
