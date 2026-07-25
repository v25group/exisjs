/**
 * Custom Jest-like Test Reporter for ExisJS
 */

const GREEN_BG = '\x1b[42m\x1b[30m'
const RED_BG = '\x1b[41m\x1b[30m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[90m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'
const CHECK = '√'
const CROSS = '×'

module.exports = async function* customReporter(source: AsyncIterable<any>) {
  let passedTests = 0
  let failedTests = 0
  let totalTests = 0
  let passedSuites = 0
  let failedSuites = 0
  const startTime = Date.now()

  const filesMap = new Map<string, { output: string[]; failed: boolean }>()

  const getFileData = (file: string) => {
    if (!filesMap.has(file)) {
      filesMap.set(file, { output: [], failed: false })
    }
    return filesMap.get(file)!
  }

  for await (const event of source) {
    if (!event.data) continue
    const { type, data } = event
    const { name, nesting, duration_ms, details, file } = data

    if (!file) continue
    const fileData = getFileData(file)

    if (type === 'test:pass' || type === 'test:fail') {
      // nesting 0 is the entire file suite completing
      if (nesting === 0) {
        const relPath = file.replace(process.cwd(), '').replace(/^\\|\//, '')
        const badge = fileData.failed
          ? `${RED_BG}${BOLD} FAIL ${RESET}`
          : `${GREEN_BG}${BOLD} PASS ${RESET}`

        yield `\n ${badge} ${DIM}Exis Framework${RESET} ${relPath}\n`
        for (const line of fileData.output) {
          yield line
        }

        if (fileData.failed) {
          failedSuites++
        } else {
          passedSuites++
        }
        continue
      }

      const isTest = duration_ms !== undefined || name.includes('should')

      if (type === 'test:pass') {
        if (!isTest) {
          fileData.output.push(
            `${'  '.repeat(nesting)} ${BOLD}${name}${RESET}\n`
          )
        } else {
          const timeStr = duration_ms
            ? ` ${DIM}(${Math.round(duration_ms)} ms)${RESET}`
            : ''
          fileData.output.push(
            `${'  '.repeat(nesting)} ${GREEN}${CHECK}${RESET} ${DIM}${name}${timeStr}\n`
          )
          passedTests++
          totalTests++
        }
      }

      if (type === 'test:fail') {
        if (!isTest) {
          fileData.output.push(
            `${'  '.repeat(nesting)} ${BOLD}${name}${RESET}\n`
          )
        } else {
          const timeStr = duration_ms
            ? ` ${DIM}(${Math.round(duration_ms)} ms)${RESET}`
            : ''
          fileData.output.push(
            `${'  '.repeat(nesting)} ${RED}${CROSS}${RESET} ${RED}${name}${timeStr}\n`
          )
          const errMsg =
            details?.error?.message ||
            details?.error?.cause?.message ||
            'Unknown error'
          fileData.output.push(`\n${RED}${errMsg}${RESET}\n`)
          failedTests++
          totalTests++
          fileData.failed = true
        }
      }
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(3)

  yield `\n${BOLD}Test Suites:${RESET} `
  if (failedSuites > 0) yield `${RED}${BOLD}${failedSuites} failed${RESET}, `
  yield `${GREEN}${BOLD}${passedSuites} passed${RESET}, ${passedSuites + failedSuites} total\n`

  yield `${BOLD}Tests:      ${RESET} `
  if (failedTests > 0) yield `${RED}${BOLD}${failedTests} failed${RESET}, `
  yield `${GREEN}${BOLD}${passedTests} passed${RESET}, ${totalTests} total\n`

  yield `${BOLD}Snapshots:  ${RESET} 0 total\n`
  yield `${BOLD}Time:       ${RESET} ${duration} s\n\n`
}
