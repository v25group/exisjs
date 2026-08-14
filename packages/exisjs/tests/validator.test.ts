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

    expect(() => schema.parse({})).toThrow(/Missing required field/)
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
        /Strict mode error/
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
      ).toThrow(/must be a valid email/)
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
      expect(() => numSchema.parse({ price: 5 })).toThrow(/must be >=/)
      expect(() => numSchema.parse({ price: 200 })).toThrow(/must be <=/)
    })

    it('rejects invalid types', () => {
      expect(() => numSchema.parse({ price: '50' })).toThrow(/must be a number/)
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
      expect(() => boolSchema.parse({ isActive: 'true' })).toThrow(
        /must be a boolean/
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
      expect(() => enumSchema.parse({ role: 'guest' })).toThrow(
        /must be one of/
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
        /array exceeds maximum length/
      )
    })

    it('rejects incorrect array element types', () => {
      expect(() => arrSchema.parse({ tags: ['a', 2] })).toThrow(
        /must be a string/
      )
    })
  })
})
