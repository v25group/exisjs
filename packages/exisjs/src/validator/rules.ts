// Tex rule compiler.
//
// A rule string such as "string? | min:3 | trim" is parsed once, when the
// schema is built, into a tree of small check functions. Validating a request
// is then a plain walk over the data with no parsing and no allocation beyond
// the result object. Error messages keep the established wording
// ("Missing required field: x", "Field 'x' must be ...") which TexEngine maps
// to structured error codes.

import {
  escapeHtml,
  stripHtml,
  collapseWhitespace,
  slugify,
  maskString,
  maskEmail,
  hasSqlInjection,
  hasPathTraversal,
  SQL_INJECTION_MESSAGE,
  PATH_TRAVERSAL_MESSAGE,
} from './text'

// Thrown by checks. The failing field's path is collected while the error
// unwinds through containers, so valid input never builds path strings.
export class RuleError extends Error {
  readonly path: (string | number)[] = []
  constructor(
    readonly kind: 'field' | 'missing' | 'strict' | 'input',
    readonly detail: string
  ) {
    super(detail)
  }
}

function formatPath(segments: (string | number)[]): string {
  let out = ''
  for (const seg of segments) {
    if (typeof seg === 'number') out += `[${seg}]`
    else out += out === '' ? seg : `.${seg}`
  }
  return out
}

// Keeps the established message formats that TexEngine maps to error codes
export function toLegacyError(err: RuleError): Error {
  const path = formatPath(err.path)
  switch (err.kind) {
    case 'missing':
      return new Error(`Missing required field: ${path}`)
    case 'strict':
      return new Error(
        `Strict mode error: Unknown field '${err.detail}' at path '${path}'`
      )
    case 'input':
      return new Error(err.detail)
    default:
      return new Error(`Field '${path}' ${err.detail}`)
  }
}

function prefixPath(err: unknown, segment: string | number): never {
  if (err instanceof RuleError) err.path.unshift(segment)
  throw err
}

type Check = (value: any) => any

// What the code generator (compile.ts) needs to inline a rule. Rules without
// it are called through `check`.
export type GenInfo =
  | { kind: 'string' | 'number' | 'boolean' | 'email'; m: Modifiers }
  | { kind: 'enum'; values: string[] }
  | { kind: 'object'; schema: Record<string, string> }
  | { kind: 'array'; item: FieldRule; m: Modifiers }
  | { kind: 'pass' }

export interface FieldRule {
  optional: boolean
  nullable: boolean
  defaultValue?: string
  check: Check
  gen?: GenInfo
}

// ─── Rule string parsing ─────────────────────────────────────────────────────

// Splits on `sep` only at nesting depth 0 and outside JSON string quotes, so
// "object<{\"a\":\"string | min:2\"}> | optional" splits into two parts.
function splitTopLevel(s: string, sep: '|' | '||'): string[] {
  const parts: string[] = []
  let start = 0
  let depth = 0
  let inQuotes = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '\\') i++
      else if (ch === '"') inQuotes = false
      continue
    }
    if (ch === '"') inQuotes = true
    else if (ch === '<' || ch === '{' || ch === '(' || ch === '[') depth++
    else if (ch === '>' || ch === '}' || ch === ')' || ch === ']') {
      if (depth > 0) depth--
    } else if (ch === '|' && depth === 0) {
      const isDouble = s[i + 1] === '|'
      if (sep === '||' && isDouble) {
        parts.push(s.slice(start, i).trim())
        start = i + 2
        i++
      } else if (sep === '|' && !isDouble) {
        parts.push(s.slice(start, i).trim())
        start = i + 1
      } else if (isDouble) {
        i++ // skip the other separator kind as a unit
      }
    }
  }
  const tail = s.slice(start).trim()
  if (tail !== '' || parts.length === 0) parts.push(tail)
  return parts
}

export interface Modifiers {
  min?: number
  max?: number
  defaultValue?: string
  version?: number
  coerce: boolean
  dedupe: boolean
  trim: boolean
  collapseWhitespace: boolean
  lowercase: boolean
  uppercase: boolean
  escapeHtml: boolean
  stripHtml: boolean
  slugify: boolean
  mask: boolean
  preventSql: boolean
  preventTraversal: boolean
  requireNumbers: boolean
  requireSymbols: boolean
  requireUppercase: boolean
  requireLowercase: boolean
}

function readModifiers(parts: string[], field: FieldRule): Modifiers {
  const m: Modifiers = {
    coerce: false,
    dedupe: false,
    trim: false,
    collapseWhitespace: false,
    lowercase: false,
    uppercase: false,
    escapeHtml: false,
    stripHtml: false,
    slugify: false,
    mask: false,
    preventSql: false,
    preventTraversal: false,
    requireNumbers: false,
    requireSymbols: false,
    requireUppercase: false,
    requireLowercase: false,
  }
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]
    const colon = p.indexOf(':')
    if (colon !== -1) {
      const name = p.slice(0, colon)
      const arg = p.slice(colon + 1)
      if (name === 'min' || name === 'max') {
        const n = Number(arg)
        if (arg.trim() !== '' && Number.isFinite(n)) m[name] = n
      } else if (name === 'default') m.defaultValue = arg
      else if (name === 'version') {
        const n = Number(arg)
        if (Number.isInteger(n)) m.version = n
      }
      // minDate/maxDate/maxSize/mimeTypes are enforced by TexEngine and the
      // upload middleware
      continue
    }
    switch (p) {
      case 'nullable':
        field.nullable = true
        break
      case 'optional':
        field.optional = true
        break
      case 'nullish':
        field.optional = true
        field.nullable = true
        break
      case 'coerce':
      case 'dedupe':
      case 'trim':
      case 'collapseWhitespace':
      case 'lowercase':
      case 'uppercase':
      case 'escapeHtml':
      case 'stripHtml':
      case 'slugify':
      case 'mask':
      case 'preventSql':
      case 'preventTraversal':
      case 'requireNumbers':
      case 'requireSymbols':
      case 'requireUppercase':
      case 'requireLowercase':
        m[p] = true
        break
    }
  }
  return m
}

export function compileRule(rule: string): FieldRule {
  const field: FieldRule = {
    optional: false,
    nullable: false,
    check: passThrough,
    gen: { kind: 'pass' },
  }

  // Unions first: the builder joins whole alternatives (with their own
  // modifiers) using "||", so "number | coerce || email" is two rules
  const alternatives = splitTopLevel(rule, '||')
  if (alternatives.length > 1) {
    const rules = alternatives.map(compileRule)
    field.optional = rules.some((r) => r.optional)
    field.nullable = rules.some((r) => r.nullable)
    field.check = unionCheck(rules)
    field.gen = undefined
    return field
  }

  const parts = splitTopLevel(rule, '|')
  let base = parts[0]
  if (base.endsWith('?')) {
    field.optional = true
    base = base.slice(0, -1).trim()
  }

  const m = readModifiers(parts, field)
  field.defaultValue = m.defaultValue

  // "(a || b)?" groups a whole rule; compile the inside and keep its flags
  if (base.startsWith('(') && base.endsWith(')')) {
    const inner = compileRule(base.slice(1, -1))
    field.check = inner.check
    field.gen = inner.gen
    field.optional = field.optional || inner.optional
    field.nullable = field.nullable || inner.nullable
    return field
  }

  if (base.startsWith('object<') && base.endsWith('>')) {
    const inner = parseObjectSchema(base.slice(7, -1))
    field.check = objectCheck(inner)
    if (inner) field.gen = { kind: 'object', schema: inner }
  } else if (base.startsWith('array<') && base.endsWith('>')) {
    const item = compileRule(base.slice(6, -1))
    field.check = arrayCheck(item, m)
    field.gen = { kind: 'array', item, m }
  } else if (base.startsWith('record<') && base.endsWith('>')) {
    field.check = recordCheck(compileRule(base.slice(7, -1)))
    field.gen = undefined
  } else if (base.startsWith('enum:')) {
    const values = base
      .slice(5)
      .split(',')
      .map((v) => v.trim())
    field.check = enumCheck(values)
    field.gen = { kind: 'enum', values }
  } else if (base.startsWith('literal:')) {
    field.check = literalCheck(base.slice(8))
    field.gen = undefined
  } else {
    switch (base) {
      case 'string':
        field.check = stringCheck(m)
        field.gen = { kind: 'string', m }
        break
      case 'number':
        field.check = numberCheck(m)
        field.gen = { kind: 'number', m }
        break
      case 'boolean':
        field.check = booleanCheck(m)
        field.gen = { kind: 'boolean', m }
        break
      case 'email':
        field.check = emailCheck(m)
        field.gen = { kind: 'email', m }
        break
      case 'password':
        field.check = passwordCheck(m)
        field.gen = undefined
        break
      case 'uuid':
        field.check = uuidCheck(m.version)
        field.gen = undefined
        break
      case 'cuid':
        field.check = patternCheck(CUID, 'must be a valid CUID')
        field.gen = undefined
        break
      case 'creditcard':
        field.check = creditCardCheck(m)
        field.gen = undefined
        break
      // date is validated by TexEngine; file by the upload middleware
      default:
        field.check = passThrough
    }
  }
  return field
}

// ─── Object schemas ──────────────────────────────────────────────────────────

type ObjectValidator = (obj: Record<string, any>) => any

export function compileObject(
  schema: Record<string, string>,
  strict: boolean
): ObjectValidator {
  const keys = Object.keys(schema)
  const fields = keys.map((k) => compileRule(schema[k]))
  const known = new Set(keys)

  return (obj) => {
    if (strict) {
      for (const key in obj) {
        if (!known.has(key)) throw new RuleError('strict', key)
      }
    }
    const out: Record<string, any> = {}
    let i = 0
    try {
      for (; i < keys.length; i++) {
        const key = keys[i]
        const field = fields[i]
        let value = obj[key]

        if (value === undefined || value === null) {
          if (value === null && field.nullable) {
            out[key] = null
            continue
          }
          if (field.defaultValue !== undefined) {
            value = field.defaultValue
          } else if (!field.optional) {
            throw new RuleError('missing', '')
          } else {
            continue
          }
        }
        out[key] = field.check(value)
      }
    } catch (err) {
      prefixPath(err, keys[i])
    }
    return out
  }
}

/** Builds the top-level validator TexEngine calls for every parse */
export function compileSchema(
  schema: Record<string, string>,
  strict: boolean
): (data: any) => any {
  const validate = compileObject(schema, strict)
  return (data) => {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new RuleError('input', 'Input must be a JSON object')
    }
    try {
      return validate(data)
    } catch (err) {
      throw err instanceof RuleError ? toLegacyError(err) : err
    }
  }
}

// ─── Field checks ────────────────────────────────────────────────────────────

const passThrough: Check = (value) => value

function fail(constraint: string): never {
  throw new RuleError('field', constraint)
}

function nullableCheck(rule: FieldRule): Check {
  return rule.nullable ? (v) => (v === null ? null : rule.check(v)) : rule.check
}

function applyTextModifiers(s: string, m: Modifiers): string {
  if (m.trim) s = s.trim()
  if (m.collapseWhitespace) s = collapseWhitespace(s)
  if (m.lowercase) s = s.toLowerCase()
  if (m.uppercase) s = s.toUpperCase()
  if (m.stripHtml) s = stripHtml(s)
  if (m.escapeHtml) s = escapeHtml(s)
  if (m.slugify) s = slugify(s)
  if (m.preventSql && hasSqlInjection(s)) fail(SQL_INJECTION_MESSAGE)
  if (m.preventTraversal && hasPathTraversal(s)) {
    fail(PATH_TRAVERSAL_MESSAGE)
  }
  return s
}

function stringCheck(m: Modifiers): Check {
  return (v) => {
    if (m.coerce && (typeof v === 'number' || typeof v === 'boolean')) {
      v = String(v)
    }
    if (typeof v !== 'string') fail('must be a string')
    let s = applyTextModifiers(v, m)
    if (m.mask) s = maskString(s)
    if (m.min !== undefined && s.length < m.min) {
      fail(`must be at least ${m.min} characters`)
    }
    if (m.max !== undefined && s.length > m.max) {
      fail(`must be at most ${m.max} characters`)
    }
    return s
  }
}

function numberCheck(m: Modifiers): Check {
  return (v) => {
    if (m.coerce && typeof v === 'string' && v.trim() !== '') {
      const n = Number(v)
      if (Number.isFinite(n)) v = n
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      fail('must be a number')
    }
    if (m.min !== undefined && v < m.min) fail(`must be >= ${m.min}`)
    if (m.max !== undefined && v > m.max) fail(`must be <= ${m.max}`)
    return v
  }
}

function booleanCheck(m: Modifiers): Check {
  return (v) => {
    if (m.coerce) {
      if (v === 'true' || v === '1' || v === 1) v = true
      else if (v === 'false' || v === '0' || v === 0) v = false
    }
    if (typeof v !== 'boolean') fail('must be a boolean')
    return v
  }
}

export const EMAIL = /^[^\s@]+@[^\s@]+$/

function emailCheck(m: Modifiers): Check {
  return (v) => {
    if (typeof v !== 'string') fail('must be a string')
    let s = v
    if (m.trim) s = s.trim()
    if (m.lowercase) s = s.toLowerCase()
    if (!EMAIL.test(s)) fail('must be a valid email')
    if (m.mask) s = maskEmail(s)
    return s
  }
}

function passwordCheck(m: Modifiers): Check {
  return (v) => {
    if (typeof v !== 'string') fail('must be a string')
    if (m.min !== undefined && v.length < m.min) {
      fail(`must be at least ${m.min} characters`)
    }
    if (m.max !== undefined && v.length > m.max) {
      fail(`must be at most ${m.max} characters`)
    }
    if (m.requireNumbers && !/[0-9]/.test(v)) {
      fail('must contain a number')
    }
    if (m.requireUppercase && !/[A-Z]/.test(v)) {
      fail('must contain an uppercase letter')
    }
    if (m.requireLowercase && !/[a-z]/.test(v)) {
      fail('must contain a lowercase letter')
    }
    if (m.requireSymbols && !/[^\p{L}\p{N}]/u.test(v)) {
      fail('must contain a symbol')
    }
    return v
  }
}

function enumCheck(values: string[]): Check {
  const allowed = new Set(values)
  const label = `[${values.map((v) => JSON.stringify(v)).join(', ')}]`
  return (v) => {
    if (typeof v !== 'string') fail('must be a string')
    if (!allowed.has(v)) fail(`must be one of ${label}`)
    return v
  }
}

// A literal rule is text ("literal:42"), so compare the value's string form;
// the value itself keeps its original type
function literalCheck(literal: string): Check {
  return (v) => {
    if (
      (typeof v !== 'string' &&
        typeof v !== 'number' &&
        typeof v !== 'boolean') ||
      String(v) !== literal
    ) {
      fail(`must be exactly ${JSON.stringify(literal)}`)
    }
    return v
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-([1-8])[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function uuidCheck(version: number | undefined): Check {
  return (v) => {
    const match = typeof v === 'string' ? UUID.exec(v) : null
    if (!match) fail('must be a valid UUID')
    if (version !== undefined && Number(match[1]) !== version) {
      fail(`must be a valid UUID v${version}`)
    }
    return v
  }
}

const CUID = /^c[^\s-]{8,}$/i

function patternCheck(pattern: RegExp, constraint: string): Check {
  return (v) => {
    if (typeof v !== 'string' || !pattern.test(v)) fail(constraint)
    return v
  }
}

function luhn(digits: string): boolean {
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

function creditCardCheck(m: Modifiers): Check {
  return (v) => {
    const digits = typeof v === 'string' ? v.replace(/[\s-]/g, '') : ''
    if (!/^[0-9]{12,19}$/.test(digits) || !luhn(digits)) {
      fail('must be a valid credit card number')
    }
    return m.mask ? `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}` : v
  }
}

export function parseJsonString(v: any, open: string, close: string): any {
  if (typeof v !== 'string') return v
  const s = v.trim()
  if (s.startsWith(open) && s.endsWith(close)) {
    try {
      return JSON.parse(s)
    } catch {
      return v
    }
  }
  return v
}

// Query strings and form fields often carry arrays as JSON text; a lone
// object is treated as a one-item array
export function normalizeArrayInput(v: any): any {
  if (typeof v === 'string') {
    const parsed = parseJsonString(v, '[', ']')
    if (Array.isArray(parsed)) return parsed
    const obj = parseJsonString(v, '{', '}')
    if (obj !== null && typeof obj === 'object') return [obj]
    return v
  }
  if (v !== null && typeof v === 'object') return [v]
  return v
}

export function dedupeItems(items: any[]): any[] {
  const seen = new Set<string>()
  return items.filter((x) => {
    const k = typeof x === 'object' ? JSON.stringify(x) : `${typeof x}:${x}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function arrayCheck(item: FieldRule, m: Modifiers): Check {
  const checkItem = nullableCheck(item)
  return (v) => {
    if (!Array.isArray(v)) v = normalizeArrayInput(v)
    if (!Array.isArray(v)) fail('must be an array')
    if (m.min !== undefined && v.length < m.min) {
      fail(`array must have at least ${m.min} items`)
    }
    if (m.max !== undefined && v.length > m.max) {
      fail(`array exceeds maximum length of ${m.max}`)
    }
    let out: any[] = new Array(v.length)
    for (let i = 0; i < v.length; i++) {
      try {
        out[i] = checkItem(v[i])
      } catch (err) {
        prefixPath(err, i)
      }
    }
    if (m.dedupe) out = dedupeItems(out)
    return out
  }
}

function parseObjectSchema(innerJson: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(innerJson)
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    // fall through
  }
  return null
}

function objectCheck(schema: Record<string, string> | null): Check {
  if (!schema) return passThrough
  const validate = compileObject(schema, false)
  return (v) => {
    v = parseJsonString(v, '{', '}')
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      fail('must be an object')
    }
    return validate(v)
  }
}

function recordCheck(value: FieldRule): Check {
  const checkValue = nullableCheck(value)
  return (v) => {
    v = parseJsonString(v, '{', '}')
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      fail('must be an object')
    }
    const out: Record<string, any> = {}
    for (const key of Object.keys(v)) {
      if (key === '__proto__' || key === 'constructor') continue
      try {
        out[key] = checkValue(v[key])
      } catch (err) {
        prefixPath(err, key)
      }
    }
    return out
  }
}

function unionCheck(options: FieldRule[]): Check {
  const checks = options.map(nullableCheck)
  return (v) => {
    for (const check of checks) {
      try {
        return check(v)
      } catch (err) {
        if (!(err instanceof RuleError)) throw err
      }
    }
    return fail('must match one of the allowed types')
  }
}
