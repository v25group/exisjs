import { tex } from '../src/validator/index'
import { describe, expect, it } from '../src/testing'

describe('Tex Native Validation Engine', () => {
  it('validates standard object correctly', () => {
    const schema = tex.object({
      name: tex.string({ min: 3 }),
      age: tex.number({ min: 18 }),
    })

    const validData = { name: 'Alice', age: 25 }
    const result = schema.parse(validData)
    expect(result.name).toBe('Alice')
    expect(result.age).toBe(25)
  })

  it('fails when required fields are missing', () => {
    const schema = tex.object({
      name: tex.string(),
    })

    expect(() => schema.parse({})).toThrow(/Expected value, received undefined/)
  })

  it('returns mock values when validating process.env with __EXIS_SKIP_ENV_CHECK enabled', () => {
    const schema = tex.object({
      DATABASE_URL: tex.string(),
      PORT: tex.number({ optional: true }),
    })

    process.env.__EXIS_SKIP_ENV_CHECK = 'true'
    delete process.env.DATABASE_URL
    try {
      const result = schema.parse(process.env)
      expect(result.DATABASE_URL).toBe('mock_DATABASE_URL')
    } finally {
      delete process.env.__EXIS_SKIP_ENV_CHECK
    }
  })

  it('rejects completely invalid payloads', () => {
    const schema = tex.object({
      name: tex.string(),
    })

    // Native validator expects JSON objects
    expect(() => schema.parse('Not an object')).toThrow(
      /Input must be a JSON object/
    )
    expect(() => schema.parse(123)).toThrow(/Input must be a JSON object/)
    expect(() => schema.parse(null)).toThrow(/Input must be a JSON object/)
  })

  describe('Strict Mode', () => {
    it('rejects unknown fields in strict mode', () => {
      const schema = tex.object(
        {
          name: tex.string(),
        },
        { strict: true }
      )

      expect(() => schema.parse({ name: 'Bob', extra: 'hacker' })).toThrow(
        /Unknown field not allowed in strict mode/
      )
    })

    it('allows unknown fields when strict is false', () => {
      const schema = tex.object({
        name: tex.string(),
      }) // Default strict = false

      const res = schema.parse({ name: 'Bob', extra: 'hacker' })
      expect(res.name).toBe('Bob')
      // Currently native validator ignores unknown fields and does not return them, but does not throw.
    })
  })

  describe('Nullable Fields', () => {
    it('accepts null when nullable() is used', () => {
      const schema = tex.object({
        name: tex.string().nullable(),
      })

      const res = schema.parse({ name: null })
      expect(res.name).toBe(null)
    })

    it('rejects null when not nullable', () => {
      const schema = tex.object({
        name: tex.string(),
      })

      expect(() => schema.parse({ name: null })).toThrow(
        /Expected value, received undefined/
      )
    })

    it('rejects undefined when nullable but not optional', () => {
      const schema = tex.object({
        name: tex.string().nullable(),
      })

      expect(() => schema.parse({})).toThrow(
        /Expected value, received undefined/
      )
    })
  })

  describe('Optional Fields', () => {
    it('accepts undefined when optional() is used', () => {
      const schema = tex.object({
        name: tex.string().optional(),
      })

      const res = schema.parse({})
      expect(res.name).toBe(undefined)
    })

    it('rejects undefined when not optional', () => {
      const schema = tex.object({
        name: tex.string(),
      })

      expect(() => schema.parse({})).toThrow(
        /Expected value, received undefined/
      )
    })
  })

  describe('String Validation', () => {
    const strSchema = tex.object({
      email: tex.email(),
      bio: tex.string({ optional: true }),
      uuid: tex.uuid(),
      cuid: tex.cuid({ optional: true }),
    })

    it('validates email successfully', () => {
      const res = strSchema.parse({
        email: 'test@exisjs.com',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
      })
      expect(res.email).toBe('test@exisjs.com')
    })

    it('rejects invalid email', () => {
      expect(() =>
        strSchema.parse({
          email: 'not-an-email',
          uuid: '123e4567-e89b-12d3-a456-426614174000',
        })
      ).toThrow(/Must be a valid email/)
    })
  })

  describe('Number Validation', () => {
    const numSchema = tex.object({
      price: tex.number({ min: 10, max: 100 }),
    })

    it('accepts numbers within range', () => {
      const res = numSchema.parse({ price: 50 })
      expect(res.price).toBe(50)
    })

    it('rejects numbers outside range', () => {
      expect(() => numSchema.parse({ price: 5 })).toThrow(/Must be >=/)
      expect(() => numSchema.parse({ price: 200 })).toThrow(/Must be <=/)
    })

    it('rejects invalid types', () => {
      expect(() => numSchema.parse({ price: '100' })).toThrow(
        /Must be a number/
      )
    })
  })

  describe('Boolean Validation', () => {
    const boolSchema = tex.object({
      isActive: tex.boolean(),
    })

    it('accepts valid booleans', () => {
      expect(boolSchema.parse({ isActive: true }).isActive).toBe(true)
      expect(boolSchema.parse({ isActive: false }).isActive).toBe(false)
    })

    it('rejects invalid boolean strings', () => {
      expect(() => boolSchema.parse({ isActive: 'yes' })).toThrow(
        /Must be a boolean/
      )
    })
  })

  describe('Enum Validation', () => {
    const enumSchema = tex.object({
      role: tex.enum(['admin', 'user']),
    })

    it('accepts exact enum strings', () => {
      expect(enumSchema.parse({ role: 'admin' }).role).toBe('admin')
      expect(enumSchema.parse({ role: 'user' }).role).toBe('user')
    })

    it('rejects invalid enums', () => {
      expect(() => enumSchema.parse({ role: 'SUPERADMIN' })).toThrow(
        /Must be one of/
      )
    })
  })

  describe('Array Validation', () => {
    const arrSchema = tex.object({
      tags: tex.array(tex.string(), { max: 3 }),
    })

    it('accepts valid arrays', () => {
      const res = arrSchema.parse({ tags: ['rust', 'typescript'] })
      expect(Array.isArray(res.tags)).toBe(true)
      expect(res.tags).toEqual(['rust', 'typescript'])
    })

    it('rejects arrays exceeding max limit', () => {
      expect(() => arrSchema.parse({ tags: ['a', 'b', 'c', 'd'] })).toThrow(
        /Array exceeds maximum length/
      )
    })

    it('rejects incorrect array element types', () => {
      expect(() => arrSchema.parse({ tags: [1, 2, 3] })).toThrow(
        /Must be a string/
      )
    })

    describe('Nested Object Array Validation', () => {
      const idProofSchema = tex.object({
        type: tex.enum([
          'aadhar',
          'license',
          'pan',
          'voter_id',
          'other',
        ] as const),
        url: tex.string(),
      })

      const visitSchema = tex.object({
        visitorName: tex.string(),
        idProofs: tex.array(idProofSchema, { optional: true }),
      })

      it('validates an array of objects correctly', () => {
        const payload = {
          visitorName: 'John Doe',
          idProofs: [
            { type: 'aadhar', url: 'data:image/jpeg;base64,12345' },
            { type: 'pan', url: 'https://example.com/pan.jpg' },
          ],
        }
        const res = visitSchema.parse(payload)
        expect(res.visitorName).toBe('John Doe')
        expect(Array.isArray(res.idProofs)).toBe(true)
        expect(res.idProofs?.length).toBe(2)
        expect(res.idProofs?.[0].type).toBe('aadhar')
      })

      it('allows omitting optional nested object array', () => {
        const res = visitSchema.parse({ visitorName: 'Alice' })
        expect(res.visitorName).toBe('Alice')
        expect(res.idProofs).toBeUndefined()
      })

      it('allows empty array for nested object array', () => {
        const res = visitSchema.parse({ visitorName: 'Bob', idProofs: [] })
        expect(res.visitorName).toBe('Bob')
        expect(res.idProofs).toEqual([])
      })

      it('auto-parses stringified JSON arrays (e.g. multipart/form-data)', () => {
        const payload = {
          visitorName: 'Charlie',
          idProofs: JSON.stringify([
            { type: 'license', url: 'https://example.com/license.jpg' },
          ]),
        }
        const res = visitSchema.parse(payload)
        expect(res.visitorName).toBe('Charlie')
        expect(Array.isArray(res.idProofs)).toBe(true)
        expect(res.idProofs?.[0].type).toBe('license')
      })

      it('throws precise validation error on invalid nested object property', () => {
        const payload = {
          visitorName: 'David',
          idProofs: [
            { type: 'invalid_type', url: 'https://example.com/doc.jpg' },
          ],
        }
        expect(() => visitSchema.parse(payload)).toThrow(/idProofs\[0\]\.type/)
      })
    })

    describe('Array Coercion (Query / Form parameters)', () => {
      it('coerces single string into single item array', () => {
        const schema = tex.object({
          tags: tex.array(tex.string(), { coerce: true }),
        })
        const res = schema.parse({ tags: 'javascript' })
        expect(res.tags).toEqual(['javascript'])
      })

      it('coerces comma-separated string into string array', () => {
        const schema = tex.object({
          categories: tex.array(tex.string(), { coerce: true }),
        })
        const res = schema.parse({ categories: 'electronics, gadgets, audio' })
        expect(res.categories).toEqual(['electronics', 'gadgets', 'audio'])
      })

      it('coerces comma-separated string into number array', () => {
        const schema = tex.object({
          ids: tex.array(tex.number(), { coerce: true }),
        })
        const res = schema.parse({ ids: '10, 20, 30' })
        expect(res.ids).toEqual([10, 20, 30])
      })

      it('coerces array of string numbers into number array', () => {
        const schema = tex.object({
          scores: tex.array(tex.number(), { coerce: true }),
        })
        const res = schema.parse({ scores: ['100', '95', '80'] })
        expect(res.scores).toEqual([100, 95, 80])
      })
    })
  })

  describe('Date Validation & Coercion', () => {
    it('coerces ISO date string to native Date instance', () => {
      const schema = tex.object({
        createdAt: tex.date({ coerce: true }),
      })

      const iso = '2026-09-19T10:00:00.000Z'
      const result = schema.parse({ createdAt: iso })

      expect(result.createdAt instanceof Date).toBe(true)
      expect(result.createdAt.toISOString()).toBe(iso)
    })

    it('coerces numeric timestamp to Date instance', () => {
      const schema = tex.object({
        timestamp: tex.date({ coerce: true }),
      })

      const now = 1726740000000
      const result = schema.parse({ timestamp: now })

      expect(result.timestamp instanceof Date).toBe(true)
      expect(result.timestamp.getTime()).toBe(now)
    })

    it('rejects invalid date string', () => {
      const schema = tex.object({
        eventDate: tex.date({ coerce: true }),
      })

      expect(() => schema.parse({ eventDate: 'not-a-date' })).toThrow(
        /Must be a valid date/
      )
    })

    it('enforces minDate and maxDate bounds', () => {
      const schema = tex.object({
        flightDate: tex.date({
          coerce: true,
          minDate: '2026-01-01',
          maxDate: '2026-12-31',
        }),
      })

      // Valid within range
      const valid = schema.parse({ flightDate: '2026-06-15' })
      expect(valid.flightDate instanceof Date).toBe(true)

      // Before minDate
      expect(() => schema.parse({ flightDate: '2025-12-31' })).toThrow(
        /Date must be after 2026-01-01/
      )

      // After maxDate
      expect(() => schema.parse({ flightDate: '2027-01-01' })).toThrow(
        /Date must be before 2026-12-31/
      )
    })

    it('handles nullable and optional dates cleanly', () => {
      const schema = tex.object({
        publishedAt: tex.date({ coerce: true, nullable: true }),
        archivedAt: tex.date({ coerce: true, optional: true }),
      })

      const resNull = schema.parse({ publishedAt: null })
      expect(resNull.publishedAt).toBeNull()
      expect(resNull.archivedAt).toBeUndefined()
    })
  })

  describe('Default Values and Lazy Factory Functions', () => {
    it('applies static default values across primitives when omitted', () => {
      const schema = tex.object({
        PORT: tex.number({ coerce: true, default: 3000 }),
        TIMEOUT: tex.number({ default: 5000 }),
        API_NAMESPACE: tex.string({ default: 'default_ns' }),
        THEME: tex.enum(['light', 'dark'] as const, { default: 'light' }),
        DEBUG: tex.boolean({ default: false }),
        TAGS: tex.array(tex.string(), { default: ['exis', 'framework'] }),
      })

      const result = schema.parse({})
      expect(result.PORT).toBe(3000)
      expect(result.TIMEOUT).toBe(5000)
      expect(result.API_NAMESPACE).toBe('default_ns')
      expect(result.THEME).toBe('light')
      expect(result.DEBUG).toBe(false)
      expect(result.TAGS).toEqual(['exis', 'framework'])
    })

    it('preserves provided values when present instead of defaults', () => {
      const schema = tex.object({
        PORT: tex.number({ coerce: true, default: 3000 }),
        THEME: tex.enum(['light', 'dark'] as const, { default: 'light' }),
        API_NAMESPACE: tex.string({ default: 'default_ns' }),
      })

      const result = schema.parse({
        PORT: 8080,
        THEME: 'dark',
        API_NAMESPACE: 'custom_ns',
      })
      expect(result.PORT).toBe(8080)
      expect(result.THEME).toBe('dark')
      expect(result.API_NAMESPACE).toBe('custom_ns')
    })

    it('evaluates dynamic lazy factory functions per parse call', () => {
      let counter = 0
      const schema = tex.object({
        createdAt: tex.date({
          default: () => new Date('2026-09-20T00:00:00Z'),
        }),
        requestId: tex.string({ default: () => `req_${++counter}` }),
      })

      const res1 = schema.parse({})
      expect(res1.createdAt instanceof Date).toBe(true)
      expect(res1.createdAt.toISOString()).toBe('2026-09-20T00:00:00.000Z')
      expect(res1.requestId).toBe('req_1')

      const res2 = schema.parse({})
      expect(res2.requestId).toBe('req_2')
    })
  })

  describe('Dedicated Environment Schema Parser (tex.env)', () => {
    it('automatically coerces numbers, booleans, dates, and arrays from string env vars', () => {
      const envSchema = tex.env({
        PORT: tex.number(),
        DEBUG: tex.boolean(),
        ENABLED: tex.boolean(),
        TIMEOUT: tex.number({ default: 5000 }),
        DATABASE_URL: tex.string(),
        LOG_LEVEL: tex.enum(['info', 'debug', 'error'] as const, {
          default: 'info',
        }),
        TAGS: tex.array(tex.string()),
        PORTS: tex.array(tex.number()),
      })

      const mockProcessEnv = {
        PORT: '4000',
        DEBUG: 'true',
        ENABLED: '1',
        DATABASE_URL: 'postgres://localhost:5432/mydb',
        TAGS: 'prod,web,api',
        PORTS: '80,443,8080',
      }

      const env = envSchema.parse(mockProcessEnv)
      expect(env.PORT).toBe(4000)
      expect(env.DEBUG).toBe(true)
      expect(env.ENABLED).toBe(true)
      expect(env.TIMEOUT).toBe(5000)
      expect(env.DATABASE_URL).toBe('postgres://localhost:5432/mydb')
      expect(env.LOG_LEVEL).toBe('info')
      expect(env.TAGS).toEqual(['prod', 'web', 'api'])
      expect(env.PORTS).toEqual([80, 443, 8080])
    })

    it('handles false/0 booleans and custom defaults correctly in tex.env', () => {
      const envSchema = tex.env({
        FEATURE_FLAG: tex.boolean({ default: false }),
        ANALYTICS: tex.boolean(),
        MAX_CONNECTIONS: tex.number({ default: 20 }),
      })

      const mockEnv = {
        ANALYTICS: '0',
      }

      const env = envSchema.parse(mockEnv)
      expect(env.FEATURE_FLAG).toBe(false)
      expect(env.ANALYTICS).toBe(false)
      expect(env.MAX_CONNECTIONS).toBe(20)
    })

    it('throws validation error when required environment variable is missing', () => {
      const envSchema = tex.env({
        DATABASE_URL: tex.string(),
        PORT: tex.number(),
      })

      expect(() => envSchema.parse({ PORT: '3000' })).toThrow(
        /Expected value, received undefined/
      )
    })
  })
})
