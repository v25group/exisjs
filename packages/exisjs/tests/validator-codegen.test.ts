import { compileSchema as generated } from '../src/validator/compile'
import { compileSchema as interpreted } from '../src/validator/rules'
import { tex } from '../src/validator/index'
import { describe, expect, it } from '../src/testing'

// The generated validator must behave exactly like the closure-based one:
// same output for valid input, same error message for invalid input.

const schemas: Record<string, Record<string, string>> = {
  flat: tex
    .object({
      name: tex.string({ min: 2, max: 10, trim: true }),
      email: tex.email({ toLowerCase: true }),
      age: tex.number({ min: 0, max: 150 }),
      active: tex.boolean(),
    })
    .getCompiledSchema(),
  optionalAndDefaults: tex
    .object({
      role: tex.enum(['admin', 'user'], { default: 'user' }),
      nick: tex.string({ optional: true }),
      note: tex.string({ nullable: true }),
      count: tex.number({ coerce: true, default: 5 }),
      flag: tex.boolean({ coerce: true, optional: true }),
      maybe: tex.number({ nullish: true }),
    })
    .getCompiledSchema(),
  nested: tex
    .object({
      id: tex.string({ coerce: true }),
      customer: tex.object({
        name: tex.string({ min: 1 }),
        address: tex.object({ zip: tex.string({ min: 5 }) }),
      }),
      items: tex.array(
        tex.object({ sku: tex.string(), qty: tex.number({ min: 1 }) }),
        { min: 1, max: 3 }
      ),
      tags: tex.array(tex.string({ toLowerCase: true }), {
        dedupe: true,
        optional: true,
      }),
      scores: tex.array(tex.number({ nullable: true }), { optional: true }),
    })
    .getCompiledSchema(),
  delegated: tex
    .object({
      id: tex.uuid(),
      ref: tex.union([tex.number(), tex.email()]),
      meta: tex.record(tex.number()),
      slug: tex.string({ slugify: true }),
      safe: tex.string({ preventSql: true, optional: true }),
      kind: tex.literal('v1'),
      pw: tex.password({ min: 4, requireNumbers: true }),
      anything: tex.any({ optional: true }),
    })
    .getCompiledSchema(),
}

const pool: any[] = [
  undefined,
  null,
  '',
  ' ',
  'a',
  'Ada',
  ' Ada ',
  'A@B.co',
  'not an email',
  'admin',
  'v1',
  'pw12',
  'Hello World',
  "x' or 1=1",
  '5',
  'abc',
  'true',
  '0',
  '550e8400-e29b-41d4-a716-446655440000',
  '12345',
  0,
  1,
  36,
  -1,
  200,
  1.5,
  NaN,
  Infinity,
  true,
  false,
  [],
  ['A', 'a', 'b'],
  [1, null, 2],
  [{ sku: 's', qty: 1 }],
  [{ sku: 's', qty: 0 }],
  [{ sku: 1 }, {}],
  '[{"sku":"s","qty":2}]',
  '{"zip":"12345"}',
  {},
  { a: 1, b: 2 },
  { a: 'x' },
  { name: 'N', address: { zip: '12345' } },
  { name: 'N', address: { zip: '1' } },
  { name: '', address: null },
  { zip: '123456' },
  { sku: 's', qty: 3 },
]

// Deterministic PRNG so failures reproduce
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

function run(fn: (d: any) => any, input: any): string {
  try {
    return 'ok ' + JSON.stringify(fn(input))
  } catch (err: any) {
    return 'err ' + err.message
  }
}

describe('Generated validators match the interpreted ones', () => {
  for (const [name, schema] of Object.entries(schemas)) {
    for (const strict of [false, true]) {
      it(`${name}${strict ? ' (strict)' : ''}`, () => {
        const a = generated(schema, strict)
        const b = interpreted(schema, strict)
        const keys = Object.keys(schema)
        const rand = rng(keys.length * 7919 + (strict ? 1 : 0))
        let okCount = 0

        for (let n = 0; n < 4000; n++) {
          const make = () => {
            const input: Record<string, any> = {}
            for (const k of keys) {
              const v = pool[Math.floor(rand() * pool.length)]
              if (v !== undefined) input[k] = structuredClone(v)
            }
            if (rand() < 0.1) input.extra = 1
            return input
          }
          // Identical fresh inputs, since validators may normalize in place
          const seedInput = make()
          const ra = run(a, structuredClone(seedInput))
          const rb = run(b, structuredClone(seedInput))
          if (ra !== rb) {
            throw new Error(
              `Mismatch for ${JSON.stringify(seedInput)}\n generated:   ${ra}\n interpreted: ${rb}`
            )
          }
          if (ra.startsWith('ok')) okCount++
        }

        for (const bad of [null, undefined, 'x', 5, [], true]) {
          expect(run(a, bad)).toBe(run(b, bad))
        }
        // The sample must exercise both outcomes to mean anything
        expect(okCount < 4000).toBe(true)
      })
    }
  }

  it('accepts a fully valid payload for every schema', () => {
    const valid: Record<string, any> = {
      flat: { name: ' Ada ', email: 'A@B.co', age: 36, active: true },
      optionalAndDefaults: { note: null, count: '7', flag: 'true' },
      nested: {
        id: 7,
        customer: { name: 'N', address: { zip: '12345' } },
        items: '[{"sku":"s","qty":2}]',
        tags: ['A', 'a', 'b'],
        scores: [1, null, 2],
      },
      delegated: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        ref: 'a@b.co',
        meta: { a: 1 },
        slug: 'Hello World',
        kind: 'v1',
        pw: 'pw12',
      },
    }
    for (const [name, schema] of Object.entries(schemas)) {
      const ra = run(generated(schema, false), structuredClone(valid[name]))
      const rb = run(interpreted(schema, false), structuredClone(valid[name]))
      expect(ra).toBe(rb)
      expect(ra.startsWith('ok')).toBe(true)
    }
  })

  it('handles a schema with a __proto__ key like the interpreted path', () => {
    const schema = { ['__proto__']: 'string?', name: 'string' }
    const input = () => JSON.parse('{"name":"x","__proto__":"y"}')
    expect(run(generated(schema, false), input())).toBe(
      run(interpreted(schema, false), input())
    )
    expect(({} as any).name).toBe(undefined)
  })
})
