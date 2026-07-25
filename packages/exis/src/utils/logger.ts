import pino from 'pino'
import type { LoggerConfig, Logger } from '../types'

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

  const options: pino.LoggerOptions = {
    level,
    ...(redact && redact.length > 0 && { redact }),
  }

  const streams: pino.StreamEntry[] = []

  if (pretty) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const prettyStream = require('pino-pretty')({
      colorize: true,
      translateTime: 'SYS:HH:MM:ss',
      ignore: 'pid,hostname',
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

// ─── Resolve Config ───────────────────────────────────────────────────────────

export function resolveLoggerConfig(
  config: LoggerConfig | boolean | undefined
): LoggerConfig {
  if (config === false) return { level: 'silent' as const }
  if (config === true || config === undefined) return {}
  return config
}
