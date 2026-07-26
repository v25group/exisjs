import { v, ValidatorError, ValidatorType } from '../src/utils/validator'
import { describe, expect, it, ex, beforeAll, afterAll } from '../src/testing'
// ─── String Validator ─────────────────────────────────────────────────────────

describe('v.string()', () => {
  it('accepts a valid string', () => {
    const result = v.string().parse('hello')
    expect(result).toBe('hello')
  })

  it('rejects a number', () => {
    expect(() => v.string().parse(42)).toThrow(ValidatorError)
  })

  it('rejects a boolean', () => {
    expect(() => v.string().parse(true)).toThrow(ValidatorError)
  })

  it('rejects null when required', () => {
    expect(() => v.string().parse(null)).toThrow(ValidatorError)
  })

  it('rejects undefined when required', () => {
    expect(() => v.string().parse(undefined)).toThrow(ValidatorError)
  })

  it('enforces min length', () => {
    expect(() => v.string().min(5).parse('abc')).toThrow(ValidatorError)
    expect(v.string().min(3).parse('abc')).toBe('abc')
  })

  it('enforces max length', () => {
    expect(() => v.string().max(3).parse('abcde')).toThrow(ValidatorError)
    expect(v.string().max(5).parse('abc')).toBe('abc')
  })

  it('validates email format', () => {
    expect(v.string().email().parse('user@example.com')).toBe(
      'user@example.com'
    )
    expect(() => v.string().email().parse('not-an-email')).toThrow(
      ValidatorError
    )
    expect(() => v.string().email().parse('missing@dot')).toThrow(
      ValidatorError
    )
    expect(() => v.string().email().parse('@missing.user')).toThrow(
      ValidatorError
    )
  })

  it('allows undefined when optional', () => {
    const result = v.string().optional().parse(undefined)
    expect(result).toBeUndefined()
  })

  it('allows null when optional', () => {
    const result = v.string().optional().parse(null)
    expect(result).toBeUndefined()
  })

  it('still validates value when optional and present', () => {
    expect(v.string().optional().parse('hello')).toBe('hello')
    expect(() => v.string().optional().parse(42)).toThrow(ValidatorError)
  })
})

// ─── Number Validator ─────────────────────────────────────────────────────────

describe('v.number()', () => {
  it('accepts a number', () => {
    expect(v.number().parse(42)).toBe(42)
  })

  it('coerces a numeric string', () => {
    expect(v.number().parse('42')).toBe(42)
    expect(v.number().parse('3.14')).toBeCloseTo(3.14)
  })

  it('rejects NaN-producing values', () => {
    expect(() => v.number().parse('not-a-number')).toThrow(ValidatorError)
  })

  it('rejects null when required', () => {
    expect(() => v.number().parse(null)).toThrow(ValidatorError)
  })

  it('rejects undefined when required', () => {
    expect(() => v.number().parse(undefined)).toThrow(ValidatorError)
  })

  it('enforces min value', () => {
    expect(() => v.number().min(10).parse(5)).toThrow(ValidatorError)
    expect(v.number().min(10).parse(10)).toBe(10)
    expect(v.number().min(10).parse(15)).toBe(15)
  })

  it('enforces max value', () => {
    expect(() => v.number().max(10).parse(15)).toThrow(ValidatorError)
    expect(v.number().max(10).parse(10)).toBe(10)
    expect(v.number().max(10).parse(5)).toBe(5)
  })

  it('allows undefined when optional', () => {
    expect(v.number().optional().parse(undefined)).toBeUndefined()
  })
})

// ─── Boolean Validator ────────────────────────────────────────────────────────

describe('v.boolean()', () => {
  it('accepts true and false', () => {
    expect(v.boolean().parse(true)).toBe(true)
    expect(v.boolean().parse(false)).toBe(false)
  })

  it('coerces string "true"/"1" to true', () => {
    expect(v.boolean().parse('true')).toBe(true)
    expect(v.boolean().parse('1')).toBe(true)
  })

  it('coerces string "false"/"0" to false', () => {
    expect(v.boolean().parse('false')).toBe(false)
    expect(v.boolean().parse('0')).toBe(false)
  })

  it('rejects non-boolean strings', () => {
    expect(() => v.boolean().parse('yes')).toThrow(ValidatorError)
    expect(() => v.boolean().parse('no')).toThrow(ValidatorError)
  })

  it('rejects null when required', () => {
    expect(() => v.boolean().parse(null)).toThrow(ValidatorError)
  })

  it('allows undefined when optional', () => {
    expect(v.boolean().optional().parse(undefined)).toBeUndefined()
  })
})

// ─── Object Validator ─────────────────────────────────────────────────────────

describe('v.object()', () => {
  const userSchema = v.object({
    name: v.string().min(2),
    email: v.string().email(),
    age: v.number().min(0).optional(),
  })

  it('validates a correct object', () => {
    const data = userSchema.parse({
      name: 'John',
      email: 'john@example.com',
      age: 30,
    })
    expect(data).toEqual({ name: 'John', email: 'john@example.com', age: 30 })
  })

  it('validates with optional field missing', () => {
    const data = userSchema.parse({
      name: 'John',
      email: 'john@example.com',
    })
    expect(data).toEqual({ name: 'John', email: 'john@example.com' })
    expect(data.age).toBeUndefined()
  })

  it('rejects missing required fields', () => {
    try {
      userSchema.parse({ name: 'John' })
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ValidatorError)
      const validationErr = err as ValidatorError
      expect(validationErr.errors.length).toBeGreaterThanOrEqual(1)
      expect(validationErr.errors[0].path).toBe('email')
    }
  })

  it('collects multiple errors', () => {
    try {
      userSchema.parse({})
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ValidatorError)
      const validationErr = err as ValidatorError
      // Both name and email should expect.fail
      expect(validationErr.errors.length).toBe(2)
    }
  })

  it('provides correct error paths', () => {
    try {
      userSchema.parse({ name: 'J', email: 'invalid' })
      expect.fail('Should have thrown')
    } catch (err) {
      const validationErr = err as ValidatorError
      const paths = validationErr.errors.map((e) => e.path)
      expect(paths).toContain('name')
      expect(paths).toContain('email')
    }
  })

  it('rejects non-object values', () => {
    expect(() => userSchema.parse('string')).toThrow(ValidatorError)
    expect(() => userSchema.parse(42)).toThrow(ValidatorError)
    expect(() => userSchema.parse([1, 2])).toThrow(ValidatorError)
  })

  it('rejects null when required', () => {
    expect(() => userSchema.parse(null)).toThrow(ValidatorError)
  })

  it('allows undefined when optional', () => {
    const optionalSchema = v.object({ x: v.string() }).optional()
    expect(optionalSchema.parse(undefined)).toBeUndefined()
  })

  it('validates nested objects', () => {
    const schema = v.object({
      profile: v.object({
        bio: v.string(),
      }),
    })

    const data = schema.parse({ profile: { bio: 'Hello' } })
    expect(data).toEqual({ profile: { bio: 'Hello' } })
  })
})

// ─── ValidatorError ───────────────────────────────────────────────────────────

describe('ValidatorError', () => {
  it('has correct name and errors', () => {
    const errors = [{ path: 'name', message: 'Required' }]
    const err = new ValidatorError(errors)
    expect(err.name).toBe('ValidatorError')
    expect((err as Error).message).toMatch('Validation Error: name: Required')
    expect(err.errors).toEqual(errors)
    expect(err).toBeInstanceOf(Error)
  })
})

// ─── Array Validator ──────────────────────────────────────────────────────────

describe('v.array()', () => {
  it('validates array of items', () => {
    const arr = v.array(v.string())
    expect(arr.parse(['a', 'b'])).toEqual(['a', 'b'])
    expect(() => arr.parse([1, 2])).toThrow(ValidatorError)
  })

  it('enforces min and max lengths', () => {
    const arr = v.array(v.number()).min(2).max(4)
    expect(() => arr.parse([1])).toThrow(ValidatorError)
    expect(arr.parse([1, 2, 3])).toEqual([1, 2, 3])
    expect(() => arr.parse([1, 2, 3, 4, 5])).toThrow(ValidatorError)
  })
})

// ─── Enum Validator ───────────────────────────────────────────────────────────

describe('v.enum()', () => {
  it('validates exact enum strings', () => {
    const enm = v.enum(['ADMIN', 'USER'])
    expect(enm.parse('ADMIN')).toBe('ADMIN')
    expect(() => enm.parse('GUEST')).toThrow(ValidatorError)
  })
})

// ─── Literal Validator ────────────────────────────────────────────────────────

describe('v.literal()', () => {
  it('validates exact literal values', () => {
    const lit = v.literal('exact')
    expect(lit.parse('exact')).toBe('exact')
    expect(() => lit.parse('other')).toThrow(ValidatorError)

    expect(v.literal(42).parse(42)).toBe(42)
  })
})

// ─── Union Validator ──────────────────────────────────────────────────────────

describe('v.union()', () => {
  it('validates against multiple schemas', () => {
    const un = v.union([v.string(), v.number()])
    expect(un.parse('hello')).toBe('hello')
    expect(un.parse(42)).toBe(42)
    expect(() => un.parse(true)).toThrow(ValidatorError)
  })
})

// ─── Date Validator ───────────────────────────────────────────────────────────

describe('v.date()', () => {
  it('parses valid dates', () => {
    const dt = v.date()
    expect(dt.parse('2023-01-01').toISOString()).toMatch('2023-01-01')
    expect(dt.parse(new Date('2023-01-01')).toISOString()).toMatch('2023-01-01')
    expect(dt.parse(1672531200000).getTime()).toBe(1672531200000)
  })

  it('rejects invalid dates', () => {
    expect(() => v.date().parse('not a date')).toThrow(ValidatorError)
  })
})

// ─── Record Validator ─────────────────────────────────────────────────────────

describe('v.record()', () => {
  it('validates dynamic keys with schema values', () => {
    const rec = v.record(v.number())
    expect(rec.parse({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
    expect(() => rec.parse({ a: 1, b: 'two' })).toThrow(ValidatorError)
  })
})

// ─── Modifiers (Transform, Refine, Default, Custom Messages) ──────────────────

describe('Validator Modifiers', () => {
  it('.default() supplies default values', () => {
    const def = v.string().default('hello')
    expect(def.parse(undefined)).toBe('hello')
    expect(def.parse('world')).toBe('world')
  })

  it('.default() can accept a function', () => {
    const def = v.number().default(() => Math.random())
    expect(def.parse(undefined)).toBeGreaterThanOrEqual(0)
  })

  it('.transform() changes value and type', () => {
    const tf = v.string().transform((val) => parseInt(val, 10))
    expect(tf.parse('42')).toBe(42)
  })

  it('.refine() adds custom validation', () => {
    const ref = v.number().refine((val) => val % 2 === 0, 'Must be even')
    expect(ref.parse(2)).toBe(2)
    try {
      ref.parse(3)
      expect.fail('Should throw')
    } catch (err: unknown) {
      expect((err as Error).message).toMatch('Must be even')
    }
  })

  it('custom error messages work for native methods', () => {
    try {
      v.string().min(10, 'Too short!').parse('abc')
      expect.fail('Should throw')
    } catch (err: unknown) {
      expect((err as Error).message).toMatch('Too short!')
    }
  })
})

// ─── ValidatorType base class ─────────────────────────────────────────────────

describe('ValidatorType', () => {
  it('parseAsync resolves with parsed value', async () => {
    const result = await v.string().parseAsync('hello')
    expect(result).toBe('hello')
  })

  it('parseAsync rejects with ValidatorError', async () => {
    await expect(v.string().parseAsync(42)).rejects.toThrow(ValidatorError)
  })
})
