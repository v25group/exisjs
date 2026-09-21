import pino from 'pino'
import type { LoggerConfig, Logger } from '../types'

import { STATUS_CODES } from 'node:http'
import { Transform } from 'node:stream'

// ─── Request Log Terminal Formatting Helpers ─────────────────────────────────

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || isNaN(bytes) || bytes <= 0)
    return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatLatency(ms?: number): string {
  if (ms === undefined || ms === null || isNaN(ms)) return ''
  let text: string
  if (ms < 1) text = '<1ms'
  else if (ms < 1000) text = `${Math.round(ms * 10) / 10}ms`
  else text = `${(ms / 1000).toFixed(2)}s`

  // Color coding: <50ms green, 50-250ms yellow, >250ms red
  if (ms < 50) return `\x1b[32m${text}\x1b[0m`
  if (ms < 250) return `\x1b[33m${text}\x1b[0m`
  return `\x1b[1;31m${text}\x1b[0m`
}

export function formatMethod(method = 'GET'): string {
  const m = method.toUpperCase()
  const padded = m.padEnd(7)
  switch (m) {
    case 'GET':
      return `\x1b[1;36m${padded}\x1b[0m`
    case 'POST':
      return `\x1b[1;32m${padded}\x1b[0m`
    case 'PUT':
    case 'PATCH':
      return `\x1b[1;33m${padded}\x1b[0m`
    case 'DELETE':
      return `\x1b[1;31m${padded}\x1b[0m`
    case 'QUERY':
      return `\x1b[38;2;60;160;255m\x1b[1m${padded}\x1b[0m`
    case 'SEARCH':
      return `\x1b[1;36m${padded}\x1b[0m`
    case 'OPTIONS':
    case 'HEAD':
      return `\x1b[1;35m${padded}\x1b[0m`
    case 'WS':
    case 'WSS':
    case 'UPGRADE':
      return `\x1b[38;2;160;70;255m\x1b[1m${padded}\x1b[0m`
    case 'SSE':
      return `\x1b[1;36m${padded}\x1b[0m`
    case 'PURGE':
      return `\x1b[1;31m${padded}\x1b[0m`
    case 'CONNECT':
    case 'TRACE':
      return `\x1b[1;90m${padded}\x1b[0m`
    default:
      return `\x1b[1;37m${padded}\x1b[0m`
  }
}

export function formatStatus(status: number): string {
  const phrase = STATUS_CODES[status] || ''
  const text = `${status} ${phrase}`.trim()
  if (status === 101) return `\x1b[38;2;160;70;255m\x1b[1m${text}\x1b[0m`
  if (status < 300) return `\x1b[1;32m${text}\x1b[0m`
  if (status < 400) return `\x1b[1;36m${text}\x1b[0m`
  if (status < 500) return `\x1b[1;33m${text}\x1b[0m`
  return `\x1b[1;31m${text}\x1b[0m`
}

export function formatUrl(url = '/'): string {
  const qIdx = url.indexOf('?')
  if (qIdx === -1) {
    return `\x1b[37m${url}\x1b[0m`
  }
  const path = url.slice(0, qIdx)
  const query = url.slice(qIdx)
  return `\x1b[37m${path}\x1b[0m\x1b[90m${query}\x1b[0m`
}

export function formatIp(ip?: string): string {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return ''
  return `\x1b[90m${ip}\x1b[0m`
}

export function extractValidationSummary(val: any): string {
  if (!val) return ''
  if (typeof val === 'string') return val
  const partTag = val.httpPart ? ` [${val.httpPart}]` : ''
  if (val.errors && typeof val.errors === 'object') {
    const entries = Object.entries(val.errors)
    if (entries.length === 1) {
      return `${partTag ? partTag.trim() + ': ' : ''}Field "${entries[0][0]}" ${entries[0][1]}`
    }
    if (entries.length > 1) {
      return `${partTag ? partTag.trim() + ': ' : ''}${entries.length} validation errors (${entries.map(([k]) => k).join(', ')})`
    }
  }
  if (Array.isArray(val.details) && val.details.length > 0) {
    const first = val.details[0]
    return `${partTag ? partTag.trim() + ': ' : ''}Field "${first.field}" expected ${first.expected}, received ${first.received}`
  }
  return typeof val === 'object' ? JSON.stringify(val) : String(val)
}

export function extractErrorMessage(err: any): string {
  if (!err) return ''
  if (typeof err === 'string') return err
  if (err.message) return String(err.message)
  if (err.msg) return String(err.msg)
  return typeof err === 'object' ? JSON.stringify(err) : String(err)
}

// ─── Create Logger ────────────────────────────────────────────────────────────

const DEFAULT_REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.token',
  'req.body.secret',
  '*.password',
  '*.token',
  '*.secret',
  'password',
  'token',
  'secret',
]

export function createLogger(config: LoggerConfig = {}): Logger {
  const {
    level = 'info',
    pretty = process.env.NODE_ENV !== 'production',
    redact = DEFAULT_REDACT,
  } = config

  let otelApi: any
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    otelApi = require('@opentelemetry/api')
  } catch {
    // Optional dependency
  }

  const options: pino.LoggerOptions = {
    level,
    ...(redact && redact.length > 0 && { redact }),
    mixin() {
      if (otelApi && otelApi.trace && otelApi.context) {
        const span = otelApi.trace.getSpan(otelApi.context.active())
        if (span) {
          const spanContext = span.spanContext()
          return {
            trace_id: spanContext.traceId,
            span_id: spanContext.spanId,
          }
        }
      }
      return {}
    },
  }

  const streams: pino.StreamEntry[] = []

  if (pretty) {
    const stripColonStream = new Transform({
      transform(chunk: any, _encoding: BufferEncoding, callback: () => void) {
        const str = chunk
          .toString()
          // eslint-disable-next-line no-control-regex
          .replace(/(\[\w+\](?:\x1b\[[0-9;]*m)?):/g, '$1')
        this.push(str)
        callback()
      },
    })
    stripColonStream.pipe(process.stdout)

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const prettyStream = require('pino-pretty')({
      colorize: true,
      translateTime: 'SYS:HH:MM:ss',
      ignore:
        'pid,hostname,statusCode,responseTime,method,url,contentLength,ip,validation,err,error,requestId,silentLog,probeBlocked',
      customPrettifiers: {
        level: (lvl: any) => {
          const l = String(lvl).toLowerCase()
          if (
            l.includes('error') ||
            l.includes('50') ||
            l.includes('fatal') ||
            l.includes('60')
          ) {
            return `\x1b[1;31m[error]\x1b[0m`
          }
          if (l.includes('warn') || l.includes('40')) {
            return `\x1b[1;33m[warn]\x1b[0m`
          }
          if (l.includes('debug') || l.includes('20')) {
            return `\x1b[90m[debug]\x1b[0m`
          }
          return `\x1b[38;2;160;70;255m[exis]\x1b[0m`
        },
      },
      messageFormat: (log: any, messageKey: string) => {
        if (log.statusCode !== undefined) {
          const method = formatMethod(log.method)
          const url = formatUrl(log.url)
          const status = formatStatus(log.statusCode)
          const latency = formatLatency(log.responseTime)
          const size = log.contentLength
            ? `\x1b[90m${formatBytes(log.contentLength)}\x1b[0m`
            : ''
          const ip = formatIp(log.ip)

          const parts = [method, url, status, latency, size, ip].filter(Boolean)
          let out = parts.join(' ')

          if (log.validation) {
            out += `\n   \x1b[33m└─ ⚠ Validation:\x1b[0m \x1b[90m${extractValidationSummary(log.validation)}\x1b[0m`
          } else if (log.error || log.err) {
            out += `\n   \x1b[31m└─ ✖ Error:\x1b[0m \x1b[90m${extractErrorMessage(log.error || log.err)}\x1b[0m`
          }
          return out
        }
        return log[messageKey] || ''
      },
      destination: stripColonStream,
    })
    streams.push({
      level: options.level as pino.Level,
      stream: prettyStream,
    })
  } else {
    streams.push({ level: options.level as pino.Level, stream: process.stdout })
  }

  return pino(options, pino.multistream(streams)) as unknown as Logger
}

// ─── Silent Logger ────────────────────────────────────────────────────────────

export function createSilentLogger(): Logger {
  return pino({ level: 'silent' }) as unknown as Logger
}

// ─── Type Guard ───────────────────────────────────────────────────────────────

export function isLogger(obj: unknown): obj is Logger {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'child' in obj &&
    typeof (obj as Record<string, unknown>).child === 'function' &&
    'info' in obj &&
    typeof (obj as Record<string, unknown>).info === 'function'
  )
}

export function resolveLoggerConfig(
  config: LoggerConfig | boolean | undefined
): LoggerConfig {
  if (config === false) return { level: 'silent' as const }
  if (config === true || config === undefined) return {}
  return config
}
