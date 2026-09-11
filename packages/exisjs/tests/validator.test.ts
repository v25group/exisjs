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
  })
})
