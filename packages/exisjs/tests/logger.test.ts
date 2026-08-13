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
