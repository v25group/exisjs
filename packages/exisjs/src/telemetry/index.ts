export interface TelemetryConfig {
  enabled: boolean
  serviceName?: string
  exporter?: 'otlp' | 'console'
  endpoint?: string // e.g. http://localhost:4318/v1/traces
}

let sdk: any = null

export async function initTelemetry(config: TelemetryConfig) {
  if (!config.enabled) return
  if (sdk) return // Already initialized

  const serviceName = config.serviceName || 'exisjs-app'
  const isOtlp =
    config.exporter === 'otlp' || process.env.NODE_ENV === 'production'

  try {
    const dynamicRequire = (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(id)
    }

    const { NodeSDK } = dynamicRequire('@opentelemetry/sdk-node')
    const { getNodeAutoInstrumentations } = dynamicRequire(
      '@opentelemetry/auto-instrumentations-node'
    )
    const { OTLPTraceExporter } = dynamicRequire(
      '@opentelemetry/exporter-trace-otlp-http'
    )
    const { ConsoleSpanExporter } = dynamicRequire(
      '@opentelemetry/sdk-trace-node'
    )
    const { resourceFromAttributes } = dynamicRequire(
      '@opentelemetry/resources'
    )
    const { ATTR_SERVICE_NAME } = dynamicRequire(
      '@opentelemetry/semantic-conventions'
    )

    const traceExporter = isOtlp
      ? new OTLPTraceExporter({
          url:
            config.endpoint ||
            process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
            'http://localhost:4318/v1/traces',
        })
      : new ConsoleSpanExporter()

    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
      }),
      traceExporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          // Disable extremely noisy low-level instrumentations
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-net': { enabled: false },
          '@opentelemetry/instrumentation-dns': { enabled: false },
        }),
      ],
    })

    sdk.start()

    // Ensure graceful shutdown
    process.on('SIGTERM', () => {
      sdk
        ?.shutdown()
        .then(() => console.log('OpenTelemetry SDK shut down'))
        .catch((error: any) =>
          console.log('Error shutting down OpenTelemetry SDK', error)
        )
        .finally(() => process.exit(0))
    })

    const now = new Date()
    const h = String(now.getHours()).padStart(2, '0')
    const m = String(now.getMinutes()).padStart(2, '0')
    const s = String(now.getSeconds()).padStart(2, '0')
    console.log(
      `\x1b[90m[${h}:${m}:${s}]\x1b[0m \x1b[36m[ExisJS Telemetry]\x1b[0m Started OpenTelemetry with ${isOtlp ? 'OTLP' : 'Console'} exporter`
    )
  } catch (err: any) {
    if (
      err.code === 'ERR_MODULE_NOT_FOUND' ||
      err.code === 'MODULE_NOT_FOUND'
    ) {
      console.warn(
        '\x1b[33m[ExisJS] Warning: config.telemetry is enabled, but @opentelemetry packages are not installed. To enable tracing, run:\n  npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/sdk-trace-node @opentelemetry/resources @opentelemetry/semantic-conventions @opentelemetry/api\x1b[0m'
      )
    } else {
      console.error('[ExisJS Telemetry] Failed to initialize telemetry:', err)
    }
  }
}

export function getActiveSpan() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { trace, context } = require('@opentelemetry/api')
    return trace.getSpan(context.active())
  } catch {
    return undefined
  }
}

// Re-export OpenTelemetry API primitives with safe fallbacks
let _trace: any
let _context: any
let _SpanStatusCode: any

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const otelApi = require('@opentelemetry/api')
  _trace = otelApi.trace
  _context = otelApi.context
  _SpanStatusCode = otelApi.SpanStatusCode
} catch {
  const noop = () => {
    /* noop */
  }
  _trace = {
    getSpan: () => undefined,
    getTracer: () => ({
      startSpan: () => ({
        end: noop,
        setStatus: noop,
        recordException: noop,
        setAttribute: noop,
        setAttributes: noop,
      }),
    }),
  }
  _context = {
    active: () => ({}),
    with: (_ctx: any, fn: any) => fn(),
  }
  _SpanStatusCode = {
    UNSET: 0,
    OK: 1,
    ERROR: 2,
  }
}

export const trace = _trace
export const context = _context
export const SpanStatusCode = _SpanStatusCode
