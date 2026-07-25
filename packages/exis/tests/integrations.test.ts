import { jwt } from '../src/integrations/jwt'
import { redis, createRedisClient } from '../src/integrations/redis'
import { s3, createS3Client } from '../src/integrations/s3'

// Mock dependencies
jest.mock(
  'ioredis',
  () => {
    return class MockRedis {
      constructor(public url: string) {}
      set() {}
      get() {}
    }
  },
  { virtual: true }
)

jest.mock(
  '@aws-sdk/client-s3',
  () => {
    return {
      S3Client: class MockS3 {
        constructor(public config: any) {}
      },
    }
  },
  { virtual: true }
)

describe('Zero-Config Integrations', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('JWT', () => {
    it('throws if JWT_SECRET is missing', () => {
      delete process.env.JWT_SECRET
      expect(() => jwt.sign({ id: 1 })).toThrow('missing')
      expect(() => jwt.verify('abc')).toThrow('missing')
    })

    it('signs and verifies using process.env.JWT_SECRET', () => {
      process.env.JWT_SECRET = 'super-secret-key'
      const token = jwt.sign({ id: 1 })
      const payload = jwt.verify<{ id: number }>(token)
      expect(payload.id).toBe(1)
    })
  })

  describe('Redis', () => {
    it('throws if REDIS_URL and KV_URL are missing', () => {
      delete process.env.REDIS_URL
      delete process.env.KV_URL
      expect(() => createRedisClient()).toThrow('missing')
    })

    it('creates client with REDIS_URL', () => {
      process.env.REDIS_URL = 'redis://localhost:6379'
      const client = createRedisClient()
      expect(client.url).toBe('redis://localhost:6379')
    })
  })

  describe('S3', () => {
    it('throws if credentials are missing', () => {
      delete process.env.AWS_REGION
      expect(() => createS3Client()).toThrow('missing')
    })

    it('creates client with correct config', () => {
      process.env.AWS_REGION = 'us-east-1'
      process.env.AWS_ACCESS_KEY_ID = 'key'
      process.env.AWS_SECRET_ACCESS_KEY = 'secret'

      const client = createS3Client()
      expect(client.config.region).toBe('us-east-1')
      expect(client.config.credentials.accessKeyId).toBe('key')
    })
  })

  // Dynamic imports/tests for extended
  describe('Extended Integrations Missing Env', () => {
    it('throws when env is missing', () => {
      const { createResendClient } = require('../src/integrations/resend')
      expect(() => createResendClient()).toThrow('missing')

      const { createOpenAIClient } = require('../src/integrations/openai')
      expect(() => createOpenAIClient()).toThrow('missing')

      const { createSupabaseClient } = require('../src/integrations/supabase')
      expect(() => createSupabaseClient()).toThrow('missing')

      const { createPosthogClient } = require('../src/integrations/posthog')
      expect(() => createPosthogClient()).toThrow('missing')

      const { createMongoClient } = require('../src/integrations/mongodb')
      expect(() => createMongoClient()).toThrow('missing')

      const { createPostgresClient } = require('../src/integrations/postgres')
      expect(() => createPostgresClient()).toThrow('missing')

      const { createMongooseClient } = require('../src/integrations/mongoose')
      expect(() => createMongooseClient()).toThrow('missing')
    })
  })
})
