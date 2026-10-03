import { describe, expect, it } from '../src/testing'
import {
  initTelemetry,
  getActiveSpan,
  trace,
  context,
  SpanStatusCode,
} from '../src/telemetry'

describe('Telemetry Subsystem', () => {
  it('initTelemetry should exit early if disabled', async () => {
    // Should not throw or crash
    await initTelemetry({ enabled: false })
    expect(true).toBe(true)
  })

  it('getActiveSpan returns undefined outside of span context', () => {
    const span = getActiveSpan()
    expect(span).toBeUndefined()
  })

  it('exports trace, context, and SpanStatusCode objects/enums', () => {
    expect(typeof trace).toBe('object')
    expect(typeof context).toBe('object')
    expect(typeof SpanStatusCode).toBe('object')
    expect(SpanStatusCode.OK).toBeDefined()
  })
})
