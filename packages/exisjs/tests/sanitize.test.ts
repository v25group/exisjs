import test from 'node:test'
import assert from 'node:assert'
import { v } from '../src/utils/validator'
import { sanitize } from '../src/utils/sanitize'

test('sanitize executes after coercion but before validation', () => {
  const schema = v.string().sanitize(sanitize.trim).min(3)

  const result = schema.validate('  hi  ')
  assert.strictEqual(result.success, false)
  if (!result.success) {
    assert.ok(
      result.errors[0].message.includes('String must be at least 3 characters')
    )
  }

  const result2 = schema.validate('  hello  ')
  assert.strictEqual(result2.success, true)
  if (result2.success) {
    assert.strictEqual(result2.data, 'hello')
  }
})

test('sanitize pure functions work independently', () => {
  assert.strictEqual(sanitize.trim('  hello  '), 'hello')
  assert.strictEqual(sanitize.toLowerCase('HELLO'), 'hello')
  assert.strictEqual(sanitize.clamp(1, 10)(15), 10)
  assert.strictEqual(sanitize.stripHtml('<p>hello</p>'), 'hello')
})

test('sanitize can be chained multiple times', () => {
  const schema = v
    .string()
    .sanitize(
      sanitize.trim,
      sanitize.toLowerCase,
      sanitize.removeNonAlphanumeric
    )

  const result = schema.validate('  <Hello>_World!  ')
  assert.strictEqual(result.success, true)
  if (result.success) {
    assert.strictEqual(result.data, 'helloworld')
  }
})

test('sanitize works with object deep values', () => {
  const schema = v
    .object({
      name: v.string(),
    })
    .sanitize(sanitize.deepTrimStringValues)

  const result = schema.validate({ name: '  hello  ' })
  assert.strictEqual(result.success, true)
  if (result.success) {
    assert.strictEqual(result.data.name, 'hello')
  }
})
