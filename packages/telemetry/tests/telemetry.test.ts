import test from 'node:test'
import assert from 'node:assert'
import { initTelemetry, getActiveSpan } from '../src/index'

test('Telemetry Package Tests', async (t) => {
  await t.test('initTelemetry should exit early if disabled', () => {
    // Should not throw or crash
    initTelemetry({ enabled: false })
    assert.ok(true)
  })

  await t.test(
    'getActiveSpan returns undefined outside of span context',
    () => {
      const span = getActiveSpan()
      assert.strictEqual(span, undefined)
    }
  )

  // Note: We don't call initTelemetry({ enabled: true }) in this basic test suite
  // because it would start the OpenTelemetry SDK and potentially interfere with
  // test runners or leave hanging connections. Full integration is tested in E2E.
})
