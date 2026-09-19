import test from 'node:test'
import assert from 'node:assert'
import { sanitize } from '../src/sanitize/index.js'
import { tex } from '../src/validator/index.js'

test('Sanitization Engine Tests', async (t) => {
  await t.test('Standalone Rust Sanitization (escapeHtml)', () => {
    const malicious = '<script>alert("hacked")</script>'
    const safe = sanitize.escapeHtml(malicious)
    assert.strictEqual(
      safe,
      '&lt;script&gt;alert(&quot;hacked&quot;)&lt;/script&gt;'
    )
  })

  await t.test('Standalone Rust Sanitization (stripHtml)', () => {
    const malicious = '<p>Hello <b>World</b>!</p>'
    const safe = sanitize.stripHtml(malicious)
    assert.strictEqual(safe, 'Hello World!')
  })

  await t.test('Standalone Rust Sanitization (preventSql)', () => {
    const safe = "O'Connor"
    assert.strictEqual(sanitize.preventSql(safe), "O'Connor")

    const malicious = "admin' or 1=1--"
    assert.throws(() => {
      sanitize.preventSql(malicious)
    }, /Potential SQL Injection detected/)
  })

  await t.test('Standalone Rust Sanitization (preventTraversal)', () => {
    const malicious = '../../../etc/passwd'
    assert.throws(() => {
      sanitize.preventTraversal(malicious)
    }, /Path traversal attempt detected/)
  })

  await t.test('Integration with TexBuilder Validation Schema', () => {
    const InputSchema = tex.object({
      username: tex.string({ preventSql: true, trim: true }),
      bio: tex.string({ escapeHtml: true }),
      filePath: tex.string({ preventTraversal: true }),
    })

    const InputValidator = InputSchema

    // Test successful validation & sanitization
    const result = InputValidator.parse({
      username: '  john_doe  ',
      bio: '<i>Hello</i>',
      filePath: 'images/avatar.png',
    })

    assert.strictEqual(result.username, 'john_doe') // trimmed
    assert.strictEqual(result.bio, '&lt;i&gt;Hello&lt;/i&gt;') // escaped
    assert.strictEqual(result.filePath, 'images/avatar.png')

    // Test rejection of malicious data
    assert.throws(() => {
      InputValidator.parse({
        username: "admin' or 1=1--",
        bio: 'Test',
        filePath: 'images/avatar.png',
      })
    }, /Potential SQL Injection/)
  })

  await t.test(
    'Safe String Utilities handle null and undefined gracefully',
    () => {
      assert.strictEqual(sanitize.trim(null as any), null)
      assert.strictEqual(sanitize.trim(undefined as any), undefined)
      assert.strictEqual(sanitize.trim(123 as any), 123)
      assert.strictEqual(sanitize.trim('  hello  '), 'hello')

      assert.strictEqual(sanitize.toLowerCase(null as any), null)
      assert.strictEqual(sanitize.toLowerCase(undefined as any), undefined)
      assert.strictEqual(sanitize.toLowerCase('HELLO'), 'hello')

      assert.strictEqual(sanitize.toUpperCase(null as any), null)
      assert.strictEqual(sanitize.collapseWhitespace(null as any), null)
      assert.strictEqual(sanitize.normalizeUnicode(null as any), null)
      assert.strictEqual(sanitize.slugify(null as any), null)
      assert.strictEqual(sanitize.truncate(5)(null as any), null)
      assert.strictEqual(sanitize.removeNonAlphanumeric(null as any), null)
      assert.strictEqual(sanitize.normalizeLineEndings(null as any), null)
      assert.strictEqual(sanitize.escapeHtml(null as any), null)
      assert.strictEqual(sanitize.stripHtml(null as any), null)
      assert.strictEqual(sanitize.preventSql(null as any), null)
      assert.strictEqual(sanitize.preventTraversal(null as any), null)
      assert.strictEqual(sanitize.maskEmail(null as any), null)
      assert.strictEqual(sanitize.maskString(null as any), null)
    }
  )

  await t.test(
    'Pre-validation sanitizers skip null values on nullable fields',
    () => {
      // Unsafe sanitizer that explicitly calls .trim() without guarding null
      const unsafeTrim = (val: any) => val.trim()

      const Schema = tex.object({
        name: tex.string().nullable().sanitize(unsafeTrim),
        notes: tex.string({ nullable: true, trim: true }).sanitize(unsafeTrim),
        address: tex.string({ nullable: true }),
        email: tex.email({ nullable: true, trim: true }).sanitize(unsafeTrim),
        tags: tex
          .array(
            tex.string({ nullable: true, trim: true }).sanitize(unsafeTrim)
          )
          .nullable(),
      })

      // 1. All nullable fields null from database or client
      const resultNull = Schema.parse({
        name: null,
        notes: null,
        address: null,
        email: null,
        tags: [null, '  alpha  ', null],
      })

      assert.strictEqual(resultNull.name, null)
      assert.strictEqual(resultNull.notes, null)
      assert.strictEqual(resultNull.address, null)
      assert.strictEqual(resultNull.email, null)
      assert.deepStrictEqual(resultNull.tags, [null, 'alpha', null])

      // 2. Normal non-null strings get sanitized and validated
      const resultVal = Schema.parse({
        name: '  Alice  ',
        notes: '  Important note  ',
        address: '123 Main St',
        email: '  test@example.com  ',
        tags: ['  beta  '],
      })

      assert.strictEqual(resultVal.name, 'Alice')
      assert.strictEqual(resultVal.notes, 'Important note')
      assert.strictEqual(resultVal.address, '123 Main St')
      assert.strictEqual(resultVal.email, 'test@example.com')
      assert.deepStrictEqual(resultVal.tags, ['beta'])

      // 3. Empty string on nullable field converts to null and skips trim sanitizer
      const resultEmpty = Schema.parse({
        name: '   ',
        notes: '',
        address: '   ',
        email: null,
        tags: null,
      })

      assert.strictEqual(resultEmpty.name, null)
      assert.strictEqual(resultEmpty.notes, null)
      assert.strictEqual(resultEmpty.address, null)
      assert.strictEqual(resultEmpty.tags, null)
    }
  )

  await t.test(
    'Post-validation refinements skip null values on nullable fields',
    async () => {
      // Refinement that blindly accesses string length / trim
      const Schema = tex.object({
        description: tex
          .string()
          .nullable()
          .refine((val) => val.trim().length > 3)
          .refineAsync(async (val) => val.trim().length < 50),
      })

      // Should not throw TypeError: Cannot read properties of null (reading 'trim')
      const syncResult = Schema.parse({ description: null })
      assert.strictEqual(syncResult.description, null)

      const asyncResult = await Schema.parseAsync({ description: null })
      assert.strictEqual(asyncResult.description, null)

      // Valid string passes refinements
      const validResult = await Schema.parseAsync({
        description: '  Valid description  ',
      })
      assert.strictEqual(validResult.description, '  Valid description  ')
    }
  )
})
