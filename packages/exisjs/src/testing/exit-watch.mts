/**
 * Preloaded into every test process by `exisjs test`. A file whose tests are
 * done but whose process stays alive (an open database client, a timer)
 * would otherwise hang the run without output: this names what is still open
 * and fails the file instead.
 */
import { after } from 'node:test'

const graceMs = Number(process.env.EXIS_TEST_EXIT_GRACE_MS) || 5000

after(() => {
  setTimeout(() => {
    const open = process
      .getActiveResourcesInfo()
      // The test runner's own stdio and IPC pipes
      .filter((r) => r !== 'TTYWrap' && r !== 'PipeWrap')
    process.stderr.write(
      `Tests finished but the process did not exit after ${graceMs / 1000} s. ` +
        `Still open: ${open.join(', ') || 'unknown'}. Close clients and servers in after(), ` +
        `or run exisjs test --force-exit.\n`
    )
    process.exit(1)
  }, graceMs).unref()
})
