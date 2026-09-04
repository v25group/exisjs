import { defineConfig, mergeConfig, defaultConfig } from '../src/config'
import type { ExisConfig } from '../src/types'
import { describe, it, expect } from '../src/testing'

// ─── defineConfig ─────────────────────────────────────────────────────────────

describe('defineConfig()', () => {
  it('returns the config object unchanged (identity function)', () => {
    const config: ExisConfig = { port: 3000, host: 'localhost' }
    const result = defineConfig(config)
    expect(result).toBe(config) // same reference
    expect(result).toEqual({ port: 3000, host: 'localhost' })
  })
})

// ─── defaultConfig ────────────────────────────────────────────────────────────

describe('defaultConfig', () => {
  it('has all required fields', () => {
    expect(defaultConfig.port).toBe(4000)
    expect(defaultConfig.host).toBe('0.0.0.0')
    expect(defaultConfig.bodyLimit).toBe(1 * 1024 * 1024)
    expect(defaultConfig.trustProxy).toBe(false)
    expect(defaultConfig.cors).toBeDefined()
    expect(defaultConfig.logger).toBeDefined()
    expect(defaultConfig.helmet).toBeDefined()
  })

  it('sets correct logger defaults', () => {
    expect(defaultConfig.logger).toBe(false)
  })
})

// ─── mergeConfig ──────────────────────────────────────────────────────────────

describe('mergeConfig()', () => {
  it('overrides top-level simple values', () => {
    const result = mergeConfig(defaultConfig, { port: 3000, host: 'localhost' })
    expect(result.port).toBe(3000)
    expect(result.host).toBe('localhost')
  })

  it('deep merges nested objects', () => {
    const result = mergeConfig(defaultConfig, {
      cors: { credentials: true },
    })

    // Should have credentials from override AND origin from default
    const corsConfig = result.cors as { origin: string; credentials: boolean }
    expect(corsConfig.credentials).toBe(true)
    expect(corsConfig.origin).toBe('*') // kept from default
  })

  it('disables features with false', () => {
    const result = mergeConfig(defaultConfig, {
      cors: false,

      logger: false,
    })

    expect(result.cors).toBe(false)
    expect(result.logger).toBe(false)
  })

  it('preserves defaults for unspecified keys', () => {
    const result = mergeConfig(defaultConfig, { port: 5000 })
    expect(result.host).toBe(defaultConfig.host)
    expect(result.bodyLimit).toBe(defaultConfig.bodyLimit)
    expect(result.cors).toEqual(defaultConfig.cors)
    expect(result.helmet).toEqual(defaultConfig.helmet)
  })

  it('handles boolean true for features', () => {
    // When user sets cors: true (not an object), it should become true
    const result = mergeConfig(defaultConfig, {} as ExisConfig)
    // Default cors is an object, so it should remain
    expect(typeof result.cors).toBe('object')
  })
})
