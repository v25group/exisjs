import test from 'node:test'
import assert from 'node:assert'
import { sanitize } from '../src/sanitize/index.js'
import { tex } from '../src/validator/index.js'

test('Advanced Sanitization Engine Tests', async (t) => {
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
})
