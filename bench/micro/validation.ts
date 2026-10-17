/**
 * Body validation micro-benchmark: tex vs Ajv (what Fastify uses).
 *
 *   npm run bench:validation
 *
 * Note: Ajv only answers valid/invalid, while tex.parse also returns a new
 * object holding just the declared fields (unknown keys stripped).
 *
 * The invalid-payload group times the rejection path: tex builds the full
 * error list (path, code, message per field), Ajv its `errors` array.
 *
 * Both validators are built once outside the timed loop, the way frameworks
 * use them per request. Each iteration gets a fresh payload object because
 * tex may write defaults/coercions into its input.
 */
import Ajv from 'ajv'
import { assertFreshBuild } from '../lib/harness'

// EXIS_DIST=<path to a dist folder> measures another build (e.g. a baseline)
const lib = process.env.EXIS_DIST
if (!lib) assertFreshBuild()
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { tex } = require(lib ? `${lib}/validator` : 'exisjs/validator')

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

  // ── Field options that run on every request ─────────────────────────────────
  const texProfile = tex.object({
    name: tex.string({ trim: true, min: 2 }),
    role: tex.enum(['admin', 'user'], { default: 'user' }),
    tags: tex.array(tex.string(), { optional: true, max: 10 }),
    bio: tex.string({ optional: true, max: 500 }),
    age: tex.number({ min: 0 }).refine((n: number) => n < 150, 'too old'),
  })
  const profile = () => ({ name: '  Ada  ', tags: ['a', 'b'], age: 36 })

  // ── Query string: text converted to numbers, with defaults ──────────────────
  const texQuery = tex.object({
    page: tex.coerce.number({ default: 1 }),
    limit: tex.coerce.number({ default: 20, max: 100 }),
    q: tex.string({ optional: true }),
  })
  const query = () => ({ page: '2', limit: '50' })

  // ── Rejected payload: both list every error ─────────────────────────────────
  const ajvAll = new Ajv({ allErrors: true, coerceTypes: false })
  const ajvUserAll = ajvAll.compile({
    type: 'object',
    required: ['name', 'email', 'age'],
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 64 },
      email: { type: 'string', pattern: EMAIL_PATTERN },
      age: { type: 'number', minimum: 0, maximum: 150 },
    },
  })
  const badUser = () => ({ name: 'A', email: 'x', age: 36 })
  const texReject = () => {
    try {
      texUser.parse(badUser())
    } catch (err) {
      return err
    }
    throw new Error('tex accepted an invalid payload')
  }

  // Sanity check: both accept the payloads, so we time the success path
  if (!ajvUser(user()) || !ajvOrder(order()))
    throw new Error('Ajv rejected payload')
  texUser.parse(user())
  texOrder.parse(order())
  texProfile.parse(profile())
  texQuery.parse(query())
  if (ajvUserAll(badUser())) throw new Error('Ajv accepted an invalid payload')

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

  group('trim, default, optional array, refine (tex only)', () => {
    bench('tex', () => do_not_optimize(texProfile.parse(profile())))
  })

  group('query coercion with defaults (tex only)', () => {
    bench('tex', () => do_not_optimize(texQuery.parse(query())))
  })

  group('invalid payload, all errors', () => {
    summary(() => {
      bench('tex', () => do_not_optimize(texReject()))
      bench('ajv', () => do_not_optimize(ajvUserAll(badUser())))
    })
  })

  await run()
}

void main()
