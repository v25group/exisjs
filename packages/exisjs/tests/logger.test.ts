import {
  createLogger,
  isLogger,
  resolveLoggerConfig,
  createSilentLogger,
} from '../src/utils/logger'
import { describe, expect, it } from '../src/testing'
// ─── createLogger ─────────────────────────────────────────────────────────────

describe('createLogger()', () => {
  it('creates a logger with default info level', () => {
    const logger = createLogger({ pretty: false })
    expect(logger.level).toBe('info')
  })

  it('respects custom level', () => {
    const logger = createLogger({ level: 'debug', pretty: false })
    expect(logger.level).toBe('debug')
  })

  it('creates a silent logger', () => {
    const logger = createLogger({ level: 'silent', pretty: false })
    expect(logger.level).toBe('silent')
  })

  it('has all standard log methods', () => {
    const logger = createLogger({ level: 'silent', pretty: false })
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.trace).toBe('function')
    expect(typeof logger.fatal).toBe('function')
  })

  it('supports child loggers', () => {
    const logger = createLogger({ level: 'silent', pretty: false })
    const child = logger.child({ requestId: 'test-123' })
    expect(typeof child.info).toBe('function')
    expect(typeof child.child).toBe('function')
  })
})

// ─── createSilentLogger ──────────────────────────────────────────────────────

describe('createSilentLogger()', () => {
  it('creates a logger with silent level', () => {
    const logger = createSilentLogger()
    expect(logger.level).toBe('silent')
  })
})

// ─── isLogger ─────────────────────────────────────────────────────────────────

describe('isLogger()', () => {
  it('recognizes a Pino logger instance', () => {
    const logger = createLogger({ level: 'silent', pretty: false })
    expect(isLogger(logger)).toBe(true)
  })

  it('rejects a plain object', () => {
    expect(isLogger({ level: 'info' })).toBe(false)
  })

  it('rejects null', () => {
    expect(isLogger(null)).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isLogger(undefined)).toBe(false)
  })

  it('rejects a string', () => {
    expect(isLogger('logger')).toBe(false)
  })
})

// ─── resolveLoggerConfig ──────────────────────────────────────────────────────

describe('resolveLoggerConfig()', () => {
  it('returns silent config for false', () => {
    expect(resolveLoggerConfig(false)).toEqual({ level: 'silent' })
  })

  it('returns empty config for true', () => {
    expect(resolveLoggerConfig(true)).toEqual({})
  })

  it('returns empty config for undefined', () => {
    expect(resolveLoggerConfig(undefined)).toEqual({})
  })

  it('returns the config object for LoggerConfig', () => {
    const config = { level: 'debug' as const }
    expect(resolveLoggerConfig(config)).toBe(config) // same reference
  })
})

// ─── Public Logger API (Singleton & Configuration) ───────────────────────────

import { logger, configureLogger, setLogger } from '../src/logger'
import { QueryParam, Query } from '../src/decorators/params'

describe('Public Logger API & QueryParam', () => {
  it('exports singleton logger with logging methods', () => {
    expect(logger).toBeDefined()
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.debug).toBe('function')
  })

  it('configures the global logger via configureLogger()', () => {
    configureLogger({ level: 'debug' })
    expect(logger.level).toBe('debug')
  })

  it('allows replacing global logger via setLogger()', () => {
    const customLogger = createLogger({ level: 'warn', pretty: false })
    setLogger(customLogger)
    expect(logger.level).toBe('warn')
  })

  it('exports QueryParam and Query decorators', () => {
    expect(QueryParam).toBeDefined()
    expect(typeof QueryParam).toBe('function')
    expect(Query).toBeDefined()
    expect(typeof Query).toBe('function')
  })
})

// ─── Terminal Request Log Formatting Helpers ─────────────────────────────────

import {
  formatBytes,
  formatLatency,
  formatMethod,
  formatStatus,
  formatUrl,
  formatIp,
  extractValidationSummary,
  extractErrorMessage,
} from '../src/logger'

describe('Terminal Request Log Formatting Helpers', () => {
  it('formatBytes() formats byte sizes accurately', () => {
    expect(formatBytes(0)).toBe('')
    expect(formatBytes(124)).toBe('124 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
    expect(formatBytes(undefined)).toBe('')
  })

  it('formatLatency() formats milliseconds with threshold colors', () => {
    expect(formatLatency(0.5)).toContain('<1ms')
    expect(formatLatency(24)).toContain('24ms')
    expect(formatLatency(150)).toContain('150ms')
    expect(formatLatency(1500)).toContain('1.50s')
    expect(formatLatency(undefined)).toBe('')
  })

  it('formatMethod() pads and colorizes HTTP methods', () => {
    expect(formatMethod('GET')).toContain('GET')
    expect(formatMethod('POST')).toContain('POST')
    expect(formatMethod('DELETE')).toContain('DELETE')
    expect(formatMethod('PATCH')).toContain('PATCH')
    expect(formatMethod('OPTIONS')).toContain('OPTIONS')
    expect(formatMethod('QUERY')).toContain('QUERY')
    expect(formatMethod('SEARCH')).toContain('SEARCH')
    expect(formatMethod('WS')).toContain('WS')
    expect(formatMethod('SSE')).toContain('SSE')
    expect(formatMethod('PURGE')).toContain('PURGE')
    expect(formatMethod('CONNECT')).toContain('CONNECT')
    expect(formatMethod('TRACE')).toContain('TRACE')
  })

  it('formatStatus() maps status codes to HTTP reason phrases', () => {
    expect(formatStatus(101)).toContain('101 Switching Protocols')
    expect(formatStatus(200)).toContain('200 OK')
    expect(formatStatus(201)).toContain('201 Created')
    expect(formatStatus(400)).toContain('400 Bad Request')
    expect(formatStatus(404)).toContain('404 Not Found')
    expect(formatStatus(500)).toContain('500 Internal Server Error')
  })

  it('formatUrl() highlights path and dims query params', () => {
    expect(formatUrl('/api/v1/users')).toContain('/api/v1/users')
    const formatted = formatUrl('/api/v1/users?limit=10&page=2')
    expect(formatted).toContain('/api/v1/users')
    expect(formatted).toContain('?limit=10&page=2')
  })

  it('formatIp() omits localhost and formats remote client IPs', () => {
    expect(formatIp('127.0.0.1')).toBe('')
    expect(formatIp('::1')).toBe('')
    expect(formatIp('localhost')).toBe('')
    expect(formatIp(undefined)).toBe('')
    expect(formatIp('192.168.1.5')).toContain('192.168.1.5')
  })

  it('extractValidationSummary() produces clean summaries', () => {
    expect(extractValidationSummary('Invalid format')).toBe('Invalid format')
    expect(
      extractValidationSummary({
        errors: { email: 'must be a valid email' },
      })
    ).toBe('Field "email" must be a valid email')
    expect(
      extractValidationSummary({
        errors: { email: 'must be a valid email' },
        httpPart: 'body',
      })
    ).toBe('[body]: Field "email" must be a valid email')
    expect(
      extractValidationSummary({
        errors: { email: 'invalid', age: 'too small' },
        httpPart: 'query',
      })
    ).toBe('[query]: 2 validation errors (email, age)')
    expect(
      extractValidationSummary({
        details: [{ field: 'name', expected: 'string', received: 'number' }],
        httpPart: 'params',
      })
    ).toBe('[params]: Field "name" expected string, received number')
  })

  it('extractErrorMessage() handles strings and Error objects', () => {
    expect(extractErrorMessage('Database connection failed')).toBe(
      'Database connection failed'
    )
    expect(
      extractErrorMessage(new Error('Postgres connection pool exhausted'))
    ).toBe('Postgres connection pool exhausted')
    expect(extractErrorMessage({ message: 'Gateway timeout' })).toBe(
      'Gateway timeout'
    )
  })

  it('createLogger({ pretty: true }) creates pretty logger with custom stream', () => {
    const prettyLogger = createLogger({ pretty: true, level: 'info' })
    expect(prettyLogger).toBeDefined()
    expect(typeof prettyLogger.info).toBe('function')
  })
})
