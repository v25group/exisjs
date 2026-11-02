import { tex } from '../src/validator/tex'
import { describe, it, expect } from '../src/testing'

describe('tex.objectId', () => {
  const schema = tex.object({ id: tex.objectId() })

  it('accepts 24 hex characters in either case, and keeps a string', () => {
    for (const id of ['507f1f77bcf86cd799439011', '507F1F77BCF86CD799439011']) {
      expect(schema.parse({ id }).id).toBe(id)
    }
  })

  it('rejects anything else', () => {
    for (const id of [
      '',
      '507f1f77bcf86cd79943901',
      '507f1f77bcf86cd7994390111',
      '507f1f77bcf86cd79943901g',
      '507f1f77bcf86cd799439011\n',
      12345,
      null,
      { $ne: null },
    ]) {
      expect(schema.safeParse({ id }).success).toBe(false)
    }
  })

  it('names the problem in the error', () => {
    const result = schema.safeParse({ id: 'nope' })

    expect(JSON.stringify(result)).toContain('valid ObjectId')
  })

  it('supports optional, nullable and default', () => {
    const fields = tex.object({
      a: tex.objectId({ optional: true }),
      b: tex.objectId({ nullable: true }),
      c: tex.objectId({ default: '507f1f77bcf86cd799439011' }),
    })

    expect(fields.parse({ b: null })).toEqual({
      b: null,
      c: '507f1f77bcf86cd799439011',
    })
  })

  it('survives partial() for PATCH bodies', () => {
    const update = tex.object({ owner: tex.objectId() }).partial()

    expect(update.parse({})).toEqual({})
    expect(update.safeParse({ owner: 'nope' }).success).toBe(false)
  })

  it('converts with transform()', () => {
    const converted = tex.object({
      id: tex.objectId().transform((v) => v.toUpperCase()),
    })

    expect(converted.parse({ id: '507f1f77bcf86cd799439011' }).id).toBe(
      '507F1F77BCF86CD799439011'
    )
  })

  it('describes itself as a string in OpenAPI', () => {
    const { properties } = schema.toOpenApi() as any

    expect(properties.id.type).toBe('string')
    expect(properties.id.pattern).toBe('^[0-9a-fA-F]{24}$')
  })
})
