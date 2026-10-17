// Tex rule compiler.
//
// A rule string such as "string? | min:3 | trim" is parsed once, when the
// schema is built, into a tree of small check functions. Validating a request
// is then a plain walk over the data with no parsing and no allocation beyond
// the result object.
//
// The rule string describes the type and its modifiers. Everything a string
// cannot hold (sanitizer and refinement functions, default values, nested
// schemas' own options) comes from the schema object the rule was built from,
// passed alongside as `raw`, so nested fields behave exactly like top-level
// ones.

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
import { ValidatorError } from './error'

// Thrown by checks. The failing field's path is collected while the error
// unwinds through containers, so valid input never builds path strings. It
// is not an Error: a failed request should not pay for a stack trace.
export class RuleError {
  readonly path: (string | number)[] = []
  constructor(
    readonly kind: 'field' | 'missing' | 'strict' | 'input' | 'custom',
    readonly detail: string,
    /** Error code, when the constraint text alone does not determine it */
    readonly code?: string,
    readonly expected?: string
  ) {}

  /** The established message format ("Field 'x' must be ...") */
  get message(): string {
    const path = formatPath(this.path)
    switch (this.kind) {
      case 'missing':
        return `Missing required field: ${path}`
      case 'strict':
        return `Strict mode error: Unknown field '${this.detail}' at path '${path}'`
      case 'input':
      case 'custom':
        return this.detail
      default:
        return `Field '${path}' ${this.detail}`
    }
  }
}

export function formatPath(segments: (string | number)[]): string {
  let out = ''
  for (const seg of segments) {
    if (typeof seg === 'number') out += `[${seg}]`
    else out += out === '' ? seg : `.${seg}`
  }
  return out
}

/** Puts `segments` in front of every path in a nested schema's errors. */
export function prefixErrors(
  err: ValidatorError,
  segments: (string | number)[]
): void {
  const prefix = formatPath(segments)
  if (prefix === '') return
  for (const e of err.errors) {
    const p = e.path
    e.path =
      !p || p === 'root'
        ? prefix
        : p.startsWith('[')
          ? prefix + p
          : `${prefix}.${p}`
  }
}

function prefixPath(err: unknown, segment: string | number): never {
  if (err instanceof RuleError) err.path.unshift(segment)
  else if (err instanceof ValidatorError) prefixErrors(err, [segment])
  throw err
}

type Check = (value: any) => any

// What the code generator (compile.ts) needs to inline a rule. Rules without
// it are called through `base`.
export type GenInfo =
  | { kind: 'string' | 'number' | 'boolean' | 'email'; m: Modifiers }
  | { kind: 'enum'; values: string[] }
  | {
      kind: 'object'
      schema: Record<string, string>
      raw?: Record<string, any>
      strict: boolean
    }
  | { kind: 'array'; item: FieldRule; m: Modifiers }
  | { kind: 'pass' }

export interface FieldRule {
  optional: boolean
  nullable: boolean
  /** `default:` text from a hand-written rule string */
  defaultValue?: string
  /** A builder default (`tex.number({ default: 1 })`): a value or factory */
  defaultRef?: { value: unknown }
  /** Sanitizers, run before the type check */
  pre?: Check
  /** Synchronous refinements and transformations, run after it */
  post?: Check
  /** The type check alone */
  base: Check
  /** pre + base + post */
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

/** A rule string split into its type and modifiers, nesting kept intact */
export function ruleParts(rule: string): string[] {
  return splitTopLevel(rule, '|')
}

/** The type part of a rule string: "string? | min:2" -> "string" */
export function ruleBase(rule: string): string {
  const base = splitTopLevel(rule, '|')[0]
  return base.endsWith('?') ? base.slice(0, -1).trim() : base
}

/** Values of an `enum:` rule: JSON when a value holds `,` `|` or spaces at an end. */
export function parseEnumValues(spec: string): string[] {
  if (spec.startsWith('[')) {
    try {
      const values = JSON.parse(spec)
      if (Array.isArray(values)) return values.map(String)
    } catch {
      // fall through to the plain list
    }
  }
  return spec.split(',').map((v) => v.trim())
}

/** Encodes enum values for a rule string. */
export function formatEnumValues(values: readonly string[]): string {
  const plain = values.every(
    (v) => v !== '' && v === v.trim() && !/[,|"<>{}()[\]]/.test(v)
  )
  return plain ? values.join(',') : JSON.stringify(values)
}

/**
 * The value of a `literal:` rule. The builder writes JSON, so `literal:42`
 * is the number and `literal:"42"` the string; unquoted text that is not a
 * number or boolean is a string, as in hand-written rules.
 */
export function parseLiteral(spec: string): string | number | boolean {
  if (spec.startsWith('"')) {
    try {
      return JSON.parse(spec)
    } catch {
      return spec
    }
  }
  if (spec === 'true') return true
  if (spec === 'false') return false
  if (spec.trim() !== '' && Number.isFinite(Number(spec))) return Number(spec)
  return spec
}

export interface Modifiers {
  min?: number
  max?: number
  length?: number
  defaultValue?: string
  version?: number
  minDate?: string
  maxDate?: string
  pattern?: RegExp
  protocols?: string[]
  int: boolean
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

function readPattern(arg: string): RegExp | undefined {
  try {
    const [source, flags] = JSON.parse(arg)
    // g and y make test() stateful across calls
    return new RegExp(source, String(flags ?? '').replace(/[gy]/g, ''))
  } catch {
    return undefined
  }
}

function readModifiers(parts: string[], field: FieldRule): Modifiers {
  const m: Modifiers = {
    int: false,
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
      if (name === 'min' || name === 'max' || name === 'length') {
        const n = Number(arg)
        if (arg.trim() !== '' && Number.isFinite(n)) m[name] = n
      } else if (name === 'default') m.defaultValue = arg
      else if (name === 'version') {
        const n = Number(arg)
        if (Number.isInteger(n)) m.version = n
      } else if (name === 'minDate' || name === 'maxDate') m[name] = arg
      else if (name === 'pattern') m.pattern = readPattern(arg)
      else if (name === 'protocols') {
        m.protocols = arg.split(',').map((s) => s.trim().toLowerCase())
      }
      // maxSize/mimeTypes are enforced by the upload middleware
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
      case 'int':
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

// ─── Schema objects next to the rule string ──────────────────────────────────
// Duck-typed so this file does not import the builder classes.

function isTexType(raw: any): boolean {
  return (
    raw != null && typeof raw._raw === 'string' && Array.isArray(raw.sanitizers)
  )
}

function isEngine(raw: any): boolean {
  return raw != null && typeof raw.getCompiledSchema === 'function'
}

/** The object schema behind `raw`: an engine, or the inner engine of `.transform()` */
function engineOf(raw: any): any {
  if (isEngine(raw)) return raw
  if (
    raw != null &&
    isEngine(raw.inner) &&
    typeof raw.transformFn === 'function'
  ) {
    return raw.inner
  }
  return undefined
}

function isDiscriminatedUnion(raw: any): boolean {
  return (
    raw != null &&
    typeof raw.discriminator === 'string' &&
    typeof raw.parse === 'function'
  )
}

function sanitizerCheck(fns: ((v: any) => any)[]): Check {
  return (v) => {
    for (const fn of fns) {
      if (v === undefined || v === null) return v
      try {
        v = fn(v)
      } catch (err: any) {
        throw new RuleError(
          'custom',
          err?.message || 'Sanitization failed',
          'SANITIZATION_FAILED',
          'a value the sanitizer accepts'
        )
      }
    }
    return v
  }
}

interface Refinement {
  async: boolean
  fn: (val: any) => any
  message?: string | ((val: any) => string)
}

export function refinementMessage(r: Refinement, value: any): string {
  return typeof r.message === 'function'
    ? r.message(value)
    : r.message || 'Invalid value'
}

function postCheck(
  refinements: Refinement[],
  transforms: ((v: any) => any)[]
): Check {
  return (v) => {
    for (const r of refinements) {
      if (!r.fn(v)) {
        throw new RuleError(
          'custom',
          refinementMessage(r, v),
          'CUSTOM_VALIDATION',
          'custom refinement rule'
        )
      }
    }
    for (const t of transforms) v = t(v)
    return v
  }
}

/** Adds the functions and default of the schema object to a compiled rule. */
function attachRaw(field: FieldRule, raw: any): FieldRule {
  if (isTexType(raw)) {
    if (raw.sanitizers.length > 0) field.pre = sanitizerCheck(raw.sanitizers)
    const sync = raw.refinements.filter((r: Refinement) => !r.async)
    if (sync.length > 0 || raw.transformations.length > 0) {
      field.post = postCheck(sync, raw.transformations)
    }
    if (raw.defaultValue !== undefined) {
      field.defaultRef = { value: raw.defaultValue }
    }
  } else {
    const objectCheck = engineOf(raw)?._objectCheck
    const transform = raw?.transformFn
    if (objectCheck && transform) field.post = (v) => transform(objectCheck(v))
    else if (objectCheck || transform) field.post = objectCheck ?? transform
  }
  const { pre, base, post } = field
  field.check =
    pre && post
      ? (v) => post(base(pre(v)))
      : pre
        ? (v) => base(pre(v))
        : post
          ? (v) => post(base(v))
          : base
  return field
}

export function compileRule(rule: string, raw?: any): FieldRule {
  const field: FieldRule = {
    optional: false,
    nullable: false,
    base: passThrough,
    check: passThrough,
    gen: { kind: 'pass' },
  }

  // Unions first: the builder joins whole alternatives (with their own
  // modifiers) using "||", so "number | coerce || email" is two rules
  const alternatives = splitTopLevel(rule, '||')
  if (alternatives.length > 1) {
    const options: any[] | undefined = raw?._options
    const rules = alternatives.map((a, i) => compileRule(a, options?.[i]))
    field.optional = rules.some((r) => r.optional)
    field.nullable = rules.some((r) => r.nullable)
    field.base = unionCheck(rules)
    field.gen = undefined
    return attachRaw(field, raw)
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
    const inner = compileRule(base.slice(1, -1), { _options: raw?._options })
    field.base = inner.check
    field.gen = inner.gen
    field.optional = field.optional || inner.optional
    field.nullable = field.nullable || inner.nullable
    return attachRaw(field, raw)
  }

  if (isDiscriminatedUnion(raw)) {
    field.base = (v) => raw.parse(parseJsonString(v, '{', '}'))
    field.gen = undefined
  } else if (base.startsWith('object<') && base.endsWith('>')) {
    const engine = engineOf(raw)
    const schema: Record<string, string> | null = engine
      ? engine.getCompiledSchema()
      : parseObjectSchema(base.slice(7, -1))
    const strict = engine ? Boolean(engine.strict) : false
    const rawSchema = engine?.rawSchema
    field.base = objectCheck(schema, strict, rawSchema)
    field.gen = schema
      ? { kind: 'object', schema, raw: rawSchema, strict }
      : { kind: 'pass' }
  } else if (base.startsWith('array<') && base.endsWith('>')) {
    let inner = base.slice(6, -1)
    // Comma-split query values are strings; their items convert with the array
    if (m.coerce && /^(number|boolean)\b/.test(inner)) inner += ' | coerce'
    const item = compileRule(inner, raw?._item)
    field.base = arrayCheck(item, m)
    field.gen = { kind: 'array', item, m }
  } else if (base.startsWith('record<') && base.endsWith('>')) {
    field.base = recordCheck(compileRule(base.slice(7, -1), raw?._value))
    field.gen = undefined
  } else if (base.startsWith('enum:')) {
    const values = parseEnumValues(base.slice(5))
    field.base = enumCheck(values)
    field.gen = { kind: 'enum', values }
  } else if (base.startsWith('literal:')) {
    field.base = literalCheck(parseLiteral(base.slice(8)))
    field.gen = undefined
  } else {
    field.gen = undefined
    switch (base) {
      case 'string':
        field.base = stringCheck(m)
        field.gen = { kind: 'string', m }
        break
      case 'number':
        field.base = numberCheck(m)
        field.gen = { kind: 'number', m }
        break
      case 'boolean':
        field.base = booleanCheck(m)
        field.gen = { kind: 'boolean', m }
        break
      case 'email':
        field.base = emailCheck(m)
        field.gen = { kind: 'email', m }
        break
      case 'url':
        field.base = urlCheck(m)
        break
      case 'date':
        field.base = dateCheck(m)
        break
      case 'password':
        field.base = passwordCheck(m)
        break
      case 'uuid':
        field.base = uuidCheck(m.version)
        break
      case 'cuid':
        field.base = patternCheck(CUID, 'must be a valid CUID')
        break
      case 'creditcard':
        field.base = creditCardCheck(m)
        break
      // any; file is validated by the upload middleware
      default:
        field.base = passThrough
        field.gen = { kind: 'pass' }
    }
  }
  return attachRaw(field, raw)
}

// ─── Object schemas ──────────────────────────────────────────────────────────

type ObjectValidator = (obj: Record<string, any>) => any

/** Default values that are objects are copied, so parses never share them */
export function resolveDefault(value: unknown): any {
  if (typeof value === 'function') return value()
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    try {
      return structuredClone(value)
    } catch {
      return value
    }
  }
  return value
}

// Query strings and path params are text; number and boolean fields convert
function withQueryCoercion(rule: string): string {
  return /^(number|boolean)\b/.test(rule) && !rule.includes('||')
    ? `${rule} | coerce`
    : rule
}

export function compileFields(
  schema: Record<string, string>,
  raw: Record<string, any> | undefined,
  query = false
): FieldRule[] {
  return Object.keys(schema).map((k) =>
    compileRule(query ? withQueryCoercion(schema[k]) : schema[k], raw?.[k])
  )
}

export function compileObject(
  schema: Record<string, string>,
  strict: boolean,
  raw?: Record<string, any>,
  query = false
): ObjectValidator {
  const keys = Object.keys(schema)
  const fields = compileFields(schema, raw, query)
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

        // A blank form field counts as left out (or null when only nullable)
        if (
          (field.optional || field.nullable) &&
          typeof value === 'string' &&
          value.trim() === ''
        ) {
          value = field.nullable && !field.optional ? null : undefined
        }
        if (value === undefined || (value === null && !field.nullable)) {
          if (field.defaultRef) value = resolveDefault(field.defaultRef.value)
          else if (field.defaultValue !== undefined) value = field.defaultValue
        }
        if (field.pre && value !== undefined && value !== null) {
          value = field.pre(value)
        }
        if (value === undefined || value === null) {
          if (value === null && field.nullable) {
            out[key] = null
            continue
          }
          if (!field.optional) throw new RuleError('missing', '')
          continue
        }
        value = field.base(value)
        out[key] = field.post ? field.post(value) : value
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
  strict: boolean,
  raw?: Record<string, any>,
  query = false
): (data: any) => any {
  const validate = compileObject(schema, strict, raw, query)
  return (data) => {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new RuleError('input', 'Input must be a JSON object')
    }
    return validate(data)
  }
}

// ─── Field checks ────────────────────────────────────────────────────────────

const passThrough: Check = (value) => value

function fail(constraint: string, code?: string, expected?: string): never {
  throw new RuleError('field', constraint, code, expected)
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

export const PATTERN_FAILED = 'must match the required format'

function checkLength(s: string, m: Modifiers): void {
  if (m.min !== undefined && s.length < m.min) {
    fail(`must be at least ${m.min} characters`)
  }
  if (m.max !== undefined && s.length > m.max) {
    fail(`must be at most ${m.max} characters`)
  }
  if (m.length !== undefined && s.length !== m.length) {
    fail(`must be exactly ${m.length} characters`, 'INVALID_LENGTH')
  }
  if (m.pattern !== undefined && !m.pattern.test(s)) {
    fail(PATTERN_FAILED, 'INVALID_FORMAT', `match ${m.pattern}`)
  }
}

function stringCheck(m: Modifiers): Check {
  return (v) => {
    if (m.coerce && (typeof v === 'number' || typeof v === 'boolean')) {
      v = String(v)
    }
    if (typeof v !== 'string') fail('must be a string')
    const s = applyTextModifiers(v, m)
    checkLength(s, m)
    return m.mask ? maskString(s) : s
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
    if (m.int && !Number.isInteger(v)) {
      fail('must be an integer', 'INVALID_TYPE', 'integer')
    }
    if (m.min !== undefined && v < m.min) fail(`must be >= ${m.min}`)
    if (m.max !== undefined && v > m.max) fail(`must be <= ${m.max}`)
    return v
  }
}

/** "true" / "1" / 1 and "false" / "0" / 0, ignoring case and surrounding spaces */
export function coerceBoolean(v: any): any {
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true' || s === '1') return true
    if (s === 'false' || s === '0') return false
    return v
  }
  if (v === 1) return true
  if (v === 0) return false
  return v
}

function booleanCheck(m: Modifiers): Check {
  return (v) => {
    if (m.coerce) v = coerceBoolean(v)
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

function urlCheck(m: Modifiers): Check {
  const protocols = new Set(
    (m.protocols ?? ['http', 'https']).map((p) => `${p.replace(/:$/, '')}:`)
  )
  const allowed = [...protocols].map((p) => p.slice(0, -1)).join(', ')
  return (v) => {
    if (typeof v !== 'string') fail('must be a string')
    const s = m.trim ? v.trim() : v
    let url: URL
    try {
      url = new URL(s)
    } catch {
      return fail('must be a valid URL', 'INVALID_URL', 'absolute URL')
    }
    if (!protocols.has(url.protocol)) {
      fail(`must use ${allowed}`, 'INVALID_URL', `${allowed} URL`)
    }
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.hostname
    ) {
      fail('must be a valid URL', 'INVALID_URL', 'absolute URL')
    }
    checkLength(s, m)
    return s
  }
}

/**
 * Accepts a Date, or a date string or timestamp, and always returns a Date
 * (JSON has no date type, so a body always sends text). `coerce` is accepted
 * for compatibility and changes nothing.
 */
function dateCheck(m: Modifiers): Check {
  const min = m.minDate !== undefined ? new Date(m.minDate).getTime() : NaN
  const max = m.maxDate !== undefined ? new Date(m.maxDate).getTime() : NaN
  return (v) => {
    const isText = typeof v === 'string' || typeof v === 'number'
    if (!isText && !(v instanceof Date)) {
      fail('must be a valid date', 'INVALID_TYPE', 'valid date or date string')
    }
    const time =
      v instanceof Date
        ? v.getTime()
        : typeof v === 'string' && v.trim() === ''
          ? NaN
          : new Date(v).getTime()
    if (Number.isNaN(time)) {
      fail(
        'must be a valid date',
        'INVALID_DATE',
        'valid date string or timestamp'
      )
    }
    if (time < min) {
      fail(
        `date must be after ${m.minDate}`,
        'DATE_TOO_EARLY',
        `>= ${m.minDate}`
      )
    }
    if (time > max) {
      fail(
        `date must be before ${m.maxDate}`,
        'DATE_TOO_LATE',
        `<= ${m.maxDate}`
      )
    }
    return v instanceof Date ? v : new Date(time)
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

export function enumLabel(values: string[]): string {
  return `[${values.map((v) => JSON.stringify(v)).join(', ')}]`
}

function enumCheck(values: string[]): Check {
  const allowed = new Set(values)
  const label = enumLabel(values)
  return (v) => {
    if (typeof v !== 'string') fail('must be a string')
    if (!allowed.has(v)) fail(`must be one of ${label}`)
    return v
  }
}

function literalCheck(literal: string | number | boolean): Check {
  return (v) => {
    if (v !== literal) fail(`must be exactly ${JSON.stringify(literal)}`)
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

/** `coerce` arrays also accept "a,b,c" and a single value */
export function coerceArrayInput(v: any): any {
  const normalized = normalizeArrayInput(v)
  if (Array.isArray(normalized)) return normalized
  if (typeof v === 'string') return v.split(',').map((s) => s.trim())
  return [v]
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
  const toArray = m.coerce ? coerceArrayInput : normalizeArrayInput
  return (v) => {
    if (!Array.isArray(v)) v = toArray(v)
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

function objectCheck(
  schema: Record<string, string> | null,
  strict: boolean,
  raw?: Record<string, any>
): Check {
  if (!schema) return passThrough
  const validate = compileObject(schema, strict, raw)
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
        if (!(err instanceof RuleError) && !(err instanceof ValidatorError)) {
          throw err
        }
      }
    }
    return fail('must match one of the allowed types')
  }
}
