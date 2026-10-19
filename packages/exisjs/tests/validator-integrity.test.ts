import { tex, type Infer } from '../src/validator/index'
import { ValidatorError } from '../src/validator/error'
import { sanitize } from '../src/sanitize/index'
import { describe, it, expect } from '../src/testing'

// Runs `fn`, returns the ValidatorError it throws
function errorsOf(fn: () => unknown): ValidatorError['errors'] {
  try {
    fn()
  } catch (err) {
    if (err instanceof ValidatorError) return err.errors
    throw err
  }
  throw new Error('expected a ValidatorError')
}

describe('tex: schemas are immutable', () => {
  it('optional() on a shared field does not change other schemas', () => {
    const Name = tex.string()
    tex.object({ name: Name.optional() })
    const B = tex.object({ name: Name })
    expect(errorsOf(() => B.parse({}))[0].code).toBe('MISSING_REQUIRED_FIELD')
  })

  it('refine() and sanitize() return copies', () => {
    const Email = tex.email()
    const Company = tex.object({
      email: Email.refine((e) => e.endsWith('@acme.com'), 'company email'),
    })
    const Any = tex.object({ email: Email.sanitize((e) => e.trim()) })

    expect(Any.parse({ email: 'a@b.co' })).toEqual({ email: 'a@b.co' })
    expect(errorsOf(() => Company.parse({ email: ' a@b.co' }))[0].path).toBe(
      'email'
    )
    expect(Email.refinements).toHaveLength(0)
    expect(Email.sanitizers).toHaveLength(0)
  })
})

describe('tex: nested schemas get every rule', () => {
  it('runs sanitizers, refinements, defaults and transforms inside objects', () => {
    const Schema = tex.object({
      profile: tex.object({
        name: tex.string().sanitize((s) => s.trim()),
        age: tex.number().refine((n) => n >= 18, 'adults only'),
        role: tex.enum(['user', 'admin'], { default: 'user' }),
        tag: tex.string().transform((s) => s.toUpperCase()),
      }),
    })
    expect(
      Schema.parse({ profile: { name: ' Ada ', age: 36, tag: 'x' } })
    ).toEqual({ profile: { name: 'Ada', age: 36, role: 'user', tag: 'X' } })

    const [err] = errorsOf(() =>
      Schema.parse({ profile: { name: 'A', age: 3, tag: 'x' } })
    )
    expect(err).toMatchObject({
      path: 'profile.age',
      message: 'adults only',
      code: 'CUSTOM_VALIDATION',
    })
  })

  it('runs refinements on array items that are objects', () => {
    const Schema = tex.object({
      items: tex.array(
        tex.object({ qty: tex.number().refine((n) => n > 0, 'qty > 0') })
      ),
    })
    expect(
      errorsOf(() => Schema.parse({ items: [{ qty: 1 }, { qty: 0 }] }))[0].path
    ).toBe('items[1].qty')
  })

  it('lists every failing item and nested field, not only the first', () => {
    const Schema = tex.object({
      items: tex.array(
        tex.object({ sku: tex.string(), qty: tex.number({ min: 1 }) })
      ),
      tags: tex.array(tex.string({ min: 2 })),
      address: tex.object({
        city: tex.string(),
        zip: tex.string({ length: 5 }),
      }),
      scores: tex.record(tex.number()),
    })
    const errors = errorsOf(() =>
      Schema.parse({
        items: [{ sku: 'a', qty: 0 }, { sku: 'b', qty: 1 }, { qty: 2 }, null],
        tags: ['ok', 'x', 'y'],
        address: { zip: '1' },
        scores: { a: 1, b: 'no' },
      })
    )
    expect(errors.map((e) => e.path)).toEqual([
      'items[0].qty',
      'items[2].sku',
      'items[3]',
      'tags[1]',
      'tags[2]',
      'address.city',
      'address.zip',
      'scores.b',
    ])
    expect(errors[2].code).toBe('INVALID_TYPE')
  })

  it('validates dates in nested objects and arrays', () => {
    const Schema = tex.object({
      event: tex.object({ at: tex.date({ coerce: true }) }),
      days: tex.array(tex.date()),
    })
    const ok = Schema.parse({
      event: { at: '2026-01-02T03:04:05Z' },
      days: ['2026-01-01'],
    })
    expect(ok.event.at).toBeInstanceOf(Date)

    expect(
      errorsOf(() =>
        Schema.parse({ event: { at: { evil: 1 } }, days: ['2026-01-01'] })
      )[0]
    ).toMatchObject({ path: 'event.at', code: 'INVALID_TYPE' })
    expect(
      errorsOf(() =>
        Schema.parse({ event: { at: '2026-01-01' }, days: ['nope'] })
      )[0]
    ).toMatchObject({ path: 'days[0]', code: 'INVALID_DATE' })
  })

  it('rejects an unparsable date and always returns a Date', () => {
    const Schema = tex.object({
      at: tex.date(),
      ts: tex.date({ optional: true }),
    })
    expect(errorsOf(() => Schema.parse({ at: 'soon' }))[0].code).toBe(
      'INVALID_DATE'
    )
    const parsed = Schema.parse({ at: '2026-01-01', ts: 0 })
    expect(parsed.at).toBeInstanceOf(Date)
    expect(parsed.at.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(parsed.ts!.getTime()).toBe(0)
  })

  it('keeps strict mode on a nested object', () => {
    const Schema = tex.object({
      x: tex.object({ a: tex.string() }, { strict: true }),
    })
    expect(
      errorsOf(() => Schema.parse({ x: { a: 'q', extra: 1 } }))[0]
    ).toMatchObject({ path: 'x.extra', code: 'UNRECOGNIZED_KEYS' })
  })

  it('validates object values of a record', () => {
    const Schema = tex.object({
      m: tex.record(tex.object({ a: tex.number() })),
    })
    expect(Schema.parse({ m: { k: { a: 1 } } })).toEqual({ m: { k: { a: 1 } } })
    expect(
      errorsOf(() => Schema.parse({ m: { k: { a: 'no' } } }))[0].path
    ).toBe('m.k.a')
  })

  it('validates object options of a union', () => {
    const Schema = tex.object({
      u: tex.union([tex.string(), tex.object({ a: tex.number() })]),
    })
    expect(Schema.parse({ u: { a: 1, extra: 2 } })).toEqual({ u: { a: 1 } })
    expect(Schema.parse({ u: 's' })).toEqual({ u: 's' })
    expect(errorsOf(() => Schema.parse({ u: { a: 'x' } }))[0].path).toBe('u')
  })

  it('accepts a transformed object and a discriminated union as fields', () => {
    const Schema = tex.object({
      point: tex
        .object({ x: tex.number(), y: tex.number() })
        .transform((p) => `${p.x},${p.y}`),
      shape: tex.discriminatedUnion('kind', [
        tex.object({ kind: tex.literal('circle'), r: tex.number() }),
        tex.object({ kind: tex.literal('square'), side: tex.number() }),
      ]),
    })
    expect(
      Schema.parse({ point: { x: 1, y: 2 }, shape: { kind: 'circle', r: 3 } })
    ).toEqual({ point: '1,2', shape: { kind: 'circle', r: 3 } })
    expect(
      errorsOf(() =>
        Schema.parse({ point: { x: 1, y: 2 }, shape: { kind: 'square' } })
      )[0].path
    ).toBe('shape.side')
  })

  it('runs refineAsync() rules in nested objects and array items', async () => {
    const Schema = tex.object({
      x: tex.object({
        n: tex.number().refineAsync(async (v) => v > 10, 'too small'),
      }),
      tags: tex.array(
        tex.string().refineAsync(async (t) => t !== 'bad', 'bad tag')
      ),
    })
    await expect(
      Schema.parseAsync({ x: { n: 20 }, tags: ['ok'] })
    ).resolves.toEqual({ x: { n: 20 }, tags: ['ok'] })

    const result = await Schema.safeParseAsync({ x: { n: 1 }, tags: ['bad'] })
    expect(result.success).toBe(false)
    expect(result.errors!.map((e) => e.path)).toEqual(['x.n', 'tags[0]'])
  })
})

describe('tex: parse() leaves its input alone', () => {
  it('does not write defaults, coercions or sanitized values into the input', () => {
    const Schema = tex.object({
      name: tex.string({ trim: true }).sanitize((s) => s + '!'),
      page: tex.number({ coerce: true }),
      tags: tex.array(tex.string(), { default: () => [] }),
    })
    const input = { name: ' bob ', page: '2' }
    expect(Schema.parse(input)).toEqual({ name: 'bob !', page: 2, tags: [] })
    expect(input).toEqual({ name: ' bob ', page: '2' })
  })

  it('never shares an object default between parses', () => {
    const Schema = tex.object({
      list: tex.array(tex.any(), { default: [{ seen: [] as string[] }] }),
    })
    const a: any = Schema.parse({})
    a.list[0].seen.push('x')
    expect((Schema.parse({}) as any).list).toEqual([{ seen: [] }])
  })
})

describe('tex: errors', () => {
  it('turns a throwing sanitizer into a validation error', () => {
    const Schema = tex.object({
      q: tex.string().sanitize(sanitize.preventSql),
    })
    expect(errorsOf(() => Schema.parse({ q: "x' or 1=1" }))[0]).toMatchObject({
      path: 'q',
      code: 'SANITIZATION_FAILED',
    })
  })

  it('lists every failing field', () => {
    const Schema = tex.object({
      name: tex.string({ min: 2 }),
      email: tex.email(),
      age: tex.number().refine((n) => n < 150, 'too old'),
    })
    const errors = errorsOf(() =>
      Schema.parse({ name: 'A', email: 'x', age: 200 })
    )
    expect(errors.map((e) => e.code)).toEqual([
      'VALUE_TOO_SMALL',
      'INVALID_EMAIL',
      'CUSTOM_VALIDATION',
    ])
  })

  it('safeParse() returns errors instead of throwing', () => {
    const Schema = tex.object({ n: tex.number() })
    expect(Schema.safeParse({ n: 1 })).toEqual({
      success: true,
      data: { n: 1 },
    })
    const failed = Schema.safeParse({ n: 'x' })
    expect(failed.success).toBe(false)
    expect(failed.errors![0].path).toBe('n')
    expect(failed.error).toBeInstanceOf(ValidatorError)
  })
})

describe('tex: literals and enums', () => {
  it('keeps the literal type', () => {
    const Schema = tex.object({ v: tex.literal(42) })
    expect(Schema.parse({ v: 42 })).toEqual({ v: 42 })
    expect(errorsOf(() => Schema.parse({ v: '42' }))[0].path).toBe('v')
  })

  it('accepts literal text containing a pipe', () => {
    expect(tex.object({ v: tex.literal('a|b') }).parse({ v: 'a|b' })).toEqual({
      v: 'a|b',
    })
  })

  it('accepts enum values with commas and surrounding spaces', () => {
    const Schema = tex.object({ e: tex.enum(['a,b', ' x', 'c']) })
    expect(Schema.parse({ e: 'a,b' })).toEqual({ e: 'a,b' })
    expect(Schema.parse({ e: ' x' })).toEqual({ e: ' x' })
    expect(Schema.toOpenApi().properties.e.enum).toEqual(['a,b', ' x', 'c'])
  })
})

describe('tex: new rules', () => {
  it('string pattern and length', () => {
    const Schema = tex.object({
      code: tex.string({
        trim: true,
        toUpperCase: true,
        pattern: /^[A-Z]{3}$/,
      }),
      pin: tex.string({ length: 4 }),
    })
    expect(Schema.parse({ code: ' usd ', pin: '1234' })).toEqual({
      code: 'USD',
      pin: '1234',
    })
    const errors = errorsOf(() => Schema.parse({ code: 'US1', pin: '12' }))
    expect(errors.map((e) => e.code)).toEqual([
      'INVALID_FORMAT',
      'INVALID_LENGTH',
    ])
  })

  it('a global regex flag does not make the pattern stateful', () => {
    const Schema = tex.object({ s: tex.string({ pattern: /^a+$/g }) })
    for (let i = 0; i < 3; i++)
      expect(Schema.parse({ s: 'aa' })).toEqual({ s: 'aa' })
  })

  it('url', () => {
    const Schema = tex.object({
      site: tex.url(),
      hook: tex.url({ protocols: ['https'], optional: true }),
    })
    expect(Schema.parse({ site: 'http://a.io/x' })).toEqual({
      site: 'http://a.io/x',
    })
    expect(
      errorsOf(() => Schema.parse({ site: 'javascript:alert(1)' }))[0].code
    ).toBe('INVALID_URL')
    expect(errorsOf(() => Schema.parse({ site: 'not a url' }))[0].code).toBe(
      'INVALID_URL'
    )
    expect(
      errorsOf(() =>
        Schema.parse({ site: 'https://a.io', hook: 'http://a.io' })
      )[0].path
    ).toBe('hook')
  })

  it('integer numbers', () => {
    const Schema = tex.object({ n: tex.number({ int: true, min: 1 }) })
    expect(Schema.parse({ n: 3 })).toEqual({ n: 3 })
    expect(errorsOf(() => Schema.parse({ n: 1.5 }))[0]).toMatchObject({
      code: 'INVALID_TYPE',
      expected: 'integer',
    })
  })

  it('describes the new rules in OpenAPI', () => {
    const doc = tex
      .object(
        {
          code: tex.string({ min: 2, max: 8, pattern: /^[a-z]+$/ }),
          site: tex.url(),
          n: tex.number({ int: true }),
        },
        { strict: true }
      )
      .toOpenApi()
    expect(doc.properties.code).toMatchObject({
      type: 'string',
      minLength: 2,
      maxLength: 8,
      pattern: '^[a-z]+$',
    })
    expect(doc.properties.site).toMatchObject({ format: 'uri' })
    expect(doc.properties.n.type).toBe('integer')
    expect(doc.additionalProperties).toBe(false)
  })
})

// Found building examples/05-tasks-api: a PATCH schema made with partial()
// kept the defaults, so leaving a field out reset it (tags -> [])
describe('tex: partial() for updates', () => {
  it('leaves out fields that were not sent instead of applying defaults', () => {
    const Task = tex.object({
      title: tex.string(),
      status: tex.enum(['todo', 'done'], { default: 'todo' }),
      tags: tex.array(tex.string(), { default: () => [] }),
    })
    expect(Task.partial().parse({ title: 'x' })).toEqual({ title: 'x' })
    expect(Task.partial().parse({ status: 'done' })).toEqual({ status: 'done' })
    // The full schema still applies them
    expect(Task.parse({ title: 'x' })).toEqual({
      title: 'x',
      status: 'todo',
      tags: [],
    })
  })
})

describe('tex: object refine() and field default()', () => {
  const Passwords = tex
    .object({ password: tex.string(), confirm: tex.string() })
    .refine((d) => d.password === d.confirm, {
      message: 'Passwords must match',
      path: 'confirm',
    })

  it('checks across fields and reports on the named path', () => {
    expect(Passwords.parse({ password: 'a', confirm: 'a' })).toEqual({
      password: 'a',
      confirm: 'a',
    })
    expect(
      errorsOf(() => Passwords.parse({ password: 'a', confirm: 'b' }))[0]
    ).toMatchObject({
      path: 'confirm',
      message: 'Passwords must match',
      code: 'CUSTOM_VALIDATION',
    })
  })

  it('runs when the object is nested, and survives optional()', () => {
    const Signup = tex.object({ auth: Passwords.optional() })
    expect(Signup.parse({})).toEqual({})
    expect(
      errorsOf(() => Signup.parse({ auth: { password: 'a', confirm: 'b' } }))[0]
        .path
    ).toBe('auth.confirm')
  })

  it('default() fills a missing field and makes it optional in requests', () => {
    const Schema = tex.object({ role: tex.string().default('user') })
    expect(Schema.parse({})).toEqual({ role: 'user' })
    expect(Schema.toOpenApi().required).toBeUndefined()
  })
})

describe('tex: query and form input', () => {
  it('converts query numbers and booleans, ignoring case and spaces', () => {
    const Query: any = tex.object({
      page: tex.number({ default: 1 }),
      active: tex.boolean({ optional: true }),
      ids: tex.array(tex.number(), { coerce: true, optional: true }),
    })
    Query._isQueryOrParam = true
    expect(Query.parse({ page: '3', active: ' TRUE ', ids: '1, 2' })).toEqual({
      page: 3,
      active: true,
      ids: [1, 2],
    })
    expect(Query.parse({})).toEqual({ page: 1 })
  })

  it('treats a blank optional field as left out and applies its default', () => {
    const Form = tex.object({
      nick: tex.string({ optional: true }),
      note: tex.string({ nullable: true }),
      size: tex.number({ default: 10 }),
    })
    expect(Form.parse({ nick: '  ', note: '', size: '' })).toEqual({
      note: null,
      size: 10,
    })
  })
})

describe('sanitize', () => {
  it('stripHtml removes script content and keeps plain "<" text', () => {
    expect(sanitize.stripHtml('<script>alert(1)</script>hi')).toBe('hi')
    expect(sanitize.stripHtml('<!-- x --><b>bold</b>')).toBe('bold')
    expect(sanitize.stripHtml('a < b and c > d')).toBe('a < b and c > d')
    expect(sanitize.stripHtml('x<img src=x onerror=alert(1)')).toBe('x')
  })

  it('slugify keeps accented letters', () => {
    expect(sanitize.slugify('Café Crème Brûlée')).toBe('cafe-creme-brulee')
  })

  it('preventTraversal catches encoded and trailing "..", not "a..b"', () => {
    for (const bad of [
      '%2e%2e%2fetc',
      'a/..',
      '..\\x',
      '%252e%252e/x',
      'a\0b',
    ]) {
      expect(() => sanitize.preventTraversal(bad)).toThrow(/Path traversal/)
    }
    expect(sanitize.preventTraversal('report..final.pdf')).toBe(
      'report..final.pdf'
    )
  })

  it('pick ignores inherited keys; array sanitizers pass other types through', () => {
    expect(
      Object.keys(sanitize.pick(['constructor' as any])({ a: 1 }))
    ).toEqual([])
    expect(sanitize.dedupe('abc' as any)).toBe('abc')
    expect(sanitize.compact(null as any)).toBe(null)
  })

  it('truncate does not split an emoji; line endings and control chars', () => {
    expect(sanitize.truncate(1)('😀x')).toBe('')
    expect(sanitize.truncate(2)('😀x')).toBe('😀')
    expect(sanitize.normalizeLineEndings('a\r\nb\rc')).toBe('a\nb\nc')
    expect(sanitize.stripControlChars('a\u0000b\u202Ec\td')).toBe('abc\td')
  })

  it('numbers, arrays and deepTrim', () => {
    expect(sanitize.round(2)(1.005 + 1)).toBe(2.01)
    expect(sanitize.clamp(0, 10)(42)).toBe(10)
    expect(sanitize.limitLength(2)([1, 2, 3])).toEqual([1, 2])
    expect(sanitize.trimElements([' a ', 1])).toEqual(['a', 1])
    expect(sanitize.normalizeEmail('  Ada@Example.COM ')).toBe(
      'ada@example.com'
    )
    expect(
      sanitize.deepTrim({ a: ' x ', b: [' y '], c: { d: ' z ' } })
    ).toEqual({
      a: 'x',
      b: ['y'],
      c: { d: 'z' },
    })
  })
})

// B3 (docs/REPORT.md, 0.9.2): ValidatorError was not exported from exisjs/validator
describe('exisjs/validator exports', () => {
  it('exports the ValidatorError that parse() throws', async () => {
    const entry = await import('../src/validator/index')
    const Schema = entry.tex.object({ n: entry.tex.number() })
    try {
      Schema.parse({ n: 'x' })
      throw new Error('expected a failure')
    } catch (err) {
      expect(err).toBeInstanceOf(entry.ValidatorError)
    }
  })
})

// B4 (docs/REPORT.md, 0.9.2): tex.object(shape, { optional: true }) ignored the option
// Assignable both ways (ResolveSchema builds intersections, never identical)
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const assertType = <_T extends true>(): void => undefined

describe('tex.object() options', () => {
  it('accepts optional / nullable / nullish like the field builders', () => {
    const Body = tex.object({
      name: tex.string(),
      address: tex.object(
        { city: tex.string({ optional: true }) },
        { optional: true }
      ),
      billing: tex.object({ zip: tex.string() }, { nullish: true }),
      shipping: tex.object({ zip: tex.string() }, { nullable: true }),
    })
    expect(Body.parse({ name: 'x', shipping: null })).toEqual({
      name: 'x',
      shipping: null,
    })
    expect(Body.parse({ name: 'x', billing: null, shipping: null })).toEqual({
      name: 'x',
      billing: null,
      shipping: null,
    })
    expect(errorsOf(() => Body.parse({ name: 'x' }))[0].path).toBe('shipping')

    type Out = Infer<typeof Body>
    assertType<Same<Out['address'], { city?: string } | undefined>>()
    assertType<Same<Out['billing'], { zip: string } | null | undefined>>()
    assertType<Same<Out['shipping'], { zip: string } | null>>()
  })

  it('refuses an unknown option instead of ignoring it', () => {
    expect(() =>
      tex.object({ a: tex.string() }, { optinal: true } as any)
    ).toThrow(/unknown option "optinal"/)
  })
})
