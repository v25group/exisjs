import { tex } from '../src/validator/index'
import { describe, expect, it } from '../src/testing'

// Rules the former native validator parsed but never enforced
describe('Tex rules: types that are now enforced', () => {
  const fails = (fn: () => unknown) => {
    let threw = false
    try {
      fn()
    } catch {
      threw = true
    }
    return threw
  }

  it('uuid rejects malformed values and honours version', () => {
    const s = tex.object({ id: tex.uuid() })
    expect(s.parse({ id: '9b2e4f1a-3c5d-4e6f-8a7b-1c2d3e4f5a6b' }).id).toBe(
      '9b2e4f1a-3c5d-4e6f-8a7b-1c2d3e4f5a6b'
    )
    expect(fails(() => s.parse({ id: 'not-a-uuid' }))).toBe(true)
    const v1 = tex.object({ id: tex.uuid({ version: 1 }) })
    expect(
      fails(() => v1.parse({ id: '9b2e4f1a-3c5d-4e6f-8a7b-1c2d3e4f5a6b' }))
    ).toBe(true)
  })

  it('creditCard applies the Luhn check', () => {
    const s = tex.object({ card: tex.creditCard() })
    expect(s.parse({ card: '4111 1111 1111 1111' }).card).toBe(
      '4111 1111 1111 1111'
    )
    expect(fails(() => s.parse({ card: '4111 1111 1111 1112' }))).toBe(true)
  })

  it('literal matches its exact value', () => {
    const s = tex.object({ kind: tex.literal('create') })
    expect(s.parse({ kind: 'create' }).kind).toBe('create')
    expect(fails(() => s.parse({ kind: 'delete' }))).toBe(true)
  })

  it('union accepts the first matching alternative', () => {
    const s = tex.object({
      ref: tex.union([tex.number({ coerce: true }), tex.email()]),
    })
    expect(s.parse({ ref: '42' }).ref).toBe(42)
    expect(s.parse({ ref: 'a@b.co' }).ref).toBe('a@b.co')
    expect(fails(() => s.parse({ ref: 'neither' }))).toBe(true)
  })

  it('record validates every value', () => {
    const s = tex.object({ scores: tex.record(tex.number()) })
    expect(s.parse({ scores: { a: 1, b: 2 } }).scores).toEqual({ a: 1, b: 2 })
    expect(fails(() => s.parse({ scores: { a: 'x' } }))).toBe(true)
  })

  it('applies dedupe, slugify and collapseWhitespace', () => {
    const s = tex.object({
      tags: tex.array(tex.string(), { dedupe: true }),
      slug: tex.string({ slugify: true }),
      title: tex.string({ collapseWhitespace: true }),
    })
    const out = s.parse({
      tags: ['a', 'b', 'a'],
      slug: 'Hello World!',
      title: 'too   many    spaces',
    })
    expect(out.tags).toEqual(['a', 'b'])
    expect(out.slug).toBe('hello-world')
    expect(out.title).toBe('too many spaces')
  })

  it('strips unknown keys and enforces strict mode', () => {
    const loose = tex.object({ a: tex.string() })
    expect(loose.parse({ a: 'x', extra: 1 } as any)).toEqual({ a: 'x' })
    const strict = tex.object({ a: tex.string() }, { strict: true })
    expect(fails(() => strict.parse({ a: 'x', extra: 1 } as any))).toBe(true)
  })

  it('reports nested paths for invalid fields', () => {
    const s = tex.object({
      user: tex.object({ age: tex.number({ min: 18 }) }),
    })
    let path = ''
    try {
      s.parse({ user: { age: 3 } })
    } catch (err: any) {
      path = err.errors?.[0]?.path
    }
    expect(path).toBe('user.age')
  })
})
