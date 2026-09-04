import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'
import { trace, context, SpanStatusCode } from '@opentelemetry/api'

export interface TelemetryConfig {
  enabled: boolean
  serviceName?: string
  exporter?: 'otlp' | 'console'
  endpoint?: string // e.g. http://localhost:4318/v1/traces
}

let sdk: NodeSDK | null = null

export function initTelemetry(config: TelemetryConfig) {
  if (!config.enabled) return
  if (sdk) return // Already initialized

  const serviceName = config.serviceName || 'exisjs-app'
  const isOtlp =
    config.exporter === 'otlp' || process.env.NODE_ENV === 'production'

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
      .catch((error) =>
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
}

export function getActiveSpan() {
  return trace.getSpan(context.active())
}

export { trace, context, SpanStatusCode }
