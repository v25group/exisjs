/**
 * Body validation micro-benchmark: tex vs Ajv (what Fastify uses).
 *
 *   npm run bench:validation
 *
 * Note: Ajv only answers valid/invalid, while tex.parse also returns a new
 * object holding just the declared fields (unknown keys stripped).
 *
 * Both validators are built once outside the timed loop, the way frameworks
 * use them per request. Each iteration gets a fresh payload object because
 * tex may write defaults/coercions into its input.
 */
import Ajv from 'ajv'
import { tex } from 'exisjs/validator'
import { assertFreshBuild } from '../lib/harness'

assertFreshBuild()

// mitata is ESM-only; load it dynamically from this CommonJS script
async function main() {
  const { run, bench, group, summary, do_not_optimize } = await import('mitata')

  const ajv = new Ajv({ allErrors: false, coerceTypes: false })
  const EMAIL_PATTERN = String.raw`^[^\s@]+@[^\s@]+$`

  // ── Flat user object ────────────────────────────────────────────────────────
  const texUser = tex.object({
    name: tex.string({ min: 2, max: 64 }),
    email: tex.email(),
    age: tex.number({ min: 0, max: 150 }),
  })
  const ajvUser = ajv.compile({
    type: 'object',
    required: ['name', 'email', 'age'],
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 64 },
      email: { type: 'string', pattern: EMAIL_PATTERN },
      age: { type: 'number', minimum: 0, maximum: 150 },
    },
  })
  const user = () => ({
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    age: 36,
  })

  // ── Nested order with an array of line items ────────────────────────────────
  const texOrder = tex.object({
    id: tex.string(),
    customer: tex.object({ name: tex.string({ min: 1 }), email: tex.email() }),
    items: tex.array(
      tex.object({ sku: tex.string(), qty: tex.number({ min: 1 }) }),
      { min: 1, max: 50 }
    ),
    status: tex.enum(['pending', 'paid', 'shipped']),
  })
  const ajvOrder = ajv.compile({
    type: 'object',
    required: ['id', 'customer', 'items', 'status'],
    properties: {
      id: { type: 'string' },
      customer: {
        type: 'object',
        required: ['name', 'email'],
        properties: {
          name: { type: 'string', minLength: 1 },
          email: { type: 'string', pattern: EMAIL_PATTERN },
        },
      },
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: {
          type: 'object',
          required: ['sku', 'qty'],
          properties: {
            sku: { type: 'string' },
            qty: { type: 'number', minimum: 1 },
          },
        },
      },
      status: { enum: ['pending', 'paid', 'shipped'] },
    },
  })
  const order = () => ({
    id: 'ord_1',
    customer: { name: 'Ada', email: 'ada@example.com' },
    items: [
      { sku: 'A-1', qty: 2 },
      { sku: 'B-7', qty: 1 },
      { sku: 'C-3', qty: 5 },
    ],
    status: 'paid',
  })

  // Sanity check: both accept the payloads, so we time the success path
  if (!ajvUser(user()) || !ajvOrder(order()))
    throw new Error('Ajv rejected payload')
  texUser.parse(user())
  texOrder.parse(order())

  group('flat object (3 fields)', () => {
    summary(() => {
      bench('tex', () => do_not_optimize(texUser.parse(user())))
      bench('ajv', () => do_not_optimize(ajvUser(user())))
    })
  })

  group('nested object + array of 3', () => {
    summary(() => {
      bench('tex', () => do_not_optimize(texOrder.parse(order())))
      bench('ajv', () => do_not_optimize(ajvOrder(order())))
    })
  })

  await run()
}

void main()
