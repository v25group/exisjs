// Schema code generator.
//
// Turns a tex schema into one straight-line JavaScript function, the way Ajv
// does for JSON Schema: type checks are inlined, nested objects and arrays
// become nested blocks and loops, and the result is built as a single object
// literal. V8 optimizes this far better than a loop over check closures.
//
// Rules that are rare or involved (unions, records, passwords, dates, text
// sanitizers...) are not inlined; the generated code calls the closure from
// rules.ts for them, so behavior is defined in exactly one place. Sanitizers,
// refinements and transforms are closures too, called around the inlined
// type check.
//
// Only schema authors' data reaches the generated source, and every string
// from it is embedded with JSON.stringify. Request data and default values are
// never part of the code. Where `new Function` is unavailable (strict CSP,
// some edge runtimes) the closure-based validator from rules.ts is used.

import {
  RuleError,
  EMAIL,
  PATTERN_FAILED,
  coerceArrayInput,
  coerceBoolean,
  compileFields,
  compileSchema as compileSchemaInterpreted,
  dedupeItems,
  normalizeArrayInput,
  parseJsonString,
  prefixErrors,
  resolveDefault,
  type FieldRule,
  type Modifiers,
} from './rules'
import { ValidatorError } from './error'

type Path = string[] // JS source fragments: '"items"', 'i3', ...

class Generator {
  private id = 0
  /** Closures called from generated code as c[n](value) */
  readonly checks: ((v: any) => any)[] = []
  /** Regexes, Sets and default values referenced as x[n] */
  readonly refs: unknown[] = []

  private next(prefix: string): string {
    return `${prefix}${this.id++}`
  }

  private ref(value: unknown): string {
    this.refs.push(value)
    return `x[${this.refs.length - 1}]`
  }

  private fail(constraint: string, path: Path): string {
    return `E("field",${JSON.stringify(constraint)},[${path.join(',')}])`
  }

  /** Calls closure `fn` on `v`, attaching the path to what it throws */
  private call(fn: (v: any) => any, v: string, path: Path): string {
    this.checks.push(fn)
    return `try{${v}=c[${this.checks.length - 1}](${v})}catch(e){P(e,[${path.join(',')}])}`
  }

  /** Validates the object in `src` and assigns the cleaned copy to `dest` */
  object(
    schema: Record<string, string>,
    strict: boolean,
    src: string,
    dest: string,
    path: Path,
    raw?: Record<string, any>,
    query = false
  ): string {
    const keys = Object.keys(schema)
    const rules = compileFields(schema, raw, query)
    let code = ''

    if (strict) {
      const known = this.ref(new Set(keys))
      code += `for(const k in ${src})if(!${known}.has(k))E("strict",k,[${path.join(',')}]);`
    }

    const results: string[] = []
    let anyAbsent = false
    for (let i = 0; i < keys.length; i++) {
      const rule = rules[i]
      const key = JSON.stringify(keys[i])
      const fieldPath = [...path, key]
      const r = this.next('r')
      const v = this.next('v')
      results.push(r)

      const hasDefault =
        rule.defaultRef !== undefined || rule.defaultValue !== undefined
      const canBeAbsent = rule.optional && !hasDefault
      if (canBeAbsent) anyAbsent = true

      let body = `let ${v}=${src}[${key}];`
      // A blank form field counts as left out (or null when only nullable)
      if (rule.optional || rule.nullable) {
        const blank = rule.nullable && !rule.optional ? 'null' : 'undefined'
        body += `if(typeof ${v}==="string"&&${v}.trim()==="")${v}=${blank};`
      }
      if (hasDefault) {
        const missing = rule.nullable
          ? `${v}===undefined`
          : `${v}===undefined||${v}===null`
        const value = rule.defaultRef
          ? `R(${this.ref(rule.defaultRef.value)})`
          : JSON.stringify(rule.defaultValue)
        body += `if(${missing})${v}=${value};`
      }
      if (rule.pre) {
        body += `if(${v}!==undefined&&${v}!==null){${this.call(rule.pre, v, fieldPath)}}`
      }

      const check = `${this.value(rule, v, fieldPath, false)}${r}=${v};`
      const missing = `E("missing","",[${fieldPath.join(',')}]);`
      const present = canBeAbsent
        ? `if(${v}!==undefined&&${v}!==null){${check}}`
        : `if(${v}===undefined||${v}===null){${missing}}${check}`
      body += rule.nullable
        ? `if(${v}===null)${r}=null;else{${present}}`
        : present
      code += `let ${r};{${body}}`
    }

    if (!anyAbsent) {
      // Fixed shape: one literal, so every result shares a hidden class
      code += `${dest}={${keys.map((k, i) => `${JSON.stringify(k)}:${results[i]}`).join(',')}};`
    } else {
      code += `${dest}={};`
      for (let i = 0; i < keys.length; i++) {
        const assign = `${dest}[${JSON.stringify(keys[i])}]=${results[i]};`
        const optional =
          rules[i].optional &&
          rules[i].defaultRef === undefined &&
          rules[i].defaultValue === undefined
        code += optional ? `if(${results[i]}!==undefined)${assign}` : assign
      }
    }
    return code
  }

  /** Validates the non-null value held in variable `v`, updating it in place */
  private value(
    rule: FieldRule,
    v: string,
    path: Path,
    withPre = true
  ): string {
    let code = withPre && rule.pre ? this.call(rule.pre, v, path) : ''
    code += rule.gen
      ? this.inline(rule, v, path)
      : this.call(rule.base, v, path)
    if (rule.post) code += this.call(rule.post, v, path)
    return code
  }

  private inline(rule: FieldRule, v: string, path: Path): string {
    const gen = rule.gen!
    switch (gen.kind) {
      case 'pass':
        return ''
      case 'string':
        return this.string(rule, gen.m, v, path)
      case 'number': {
        const m = gen.m
        let code = ''
        if (m.coerce) {
          code += `if(typeof ${v}==="string"&&${v}.trim()!==""){const n=Number(${v});if(Number.isFinite(n))${v}=n}`
        }
        code += `if(typeof ${v}!=="number"||!Number.isFinite(${v}))${this.fail('must be a number', path)};`
        if (m.int) {
          code += `if(!Number.isInteger(${v}))E("field","must be an integer",[${path.join(',')}],"INVALID_TYPE","integer");`
        }
        if (m.min !== undefined) {
          code += `if(${v}<${m.min})${this.fail(`must be >= ${m.min}`, path)};`
        }
        if (m.max !== undefined) {
          code += `if(${v}>${m.max})${this.fail(`must be <= ${m.max}`, path)};`
        }
        return code
      }
      case 'boolean': {
        const code = gen.m.coerce ? `${v}=B(${v});` : ''
        return (
          code +
          `if(typeof ${v}!=="boolean")${this.fail('must be a boolean', path)};`
        )
      }
      case 'email': {
        if (gen.m.mask) return this.call(rule.base, v, path)
        let code = `if(typeof ${v}!=="string")${this.fail('must be a string', path)};`
        if (gen.m.trim) code += `${v}=${v}.trim();`
        if (gen.m.lowercase) code += `${v}=${v}.toLowerCase();`
        return (
          code +
          `if(!${this.ref(EMAIL)}.test(${v}))${this.fail('must be a valid email', path)};`
        )
      }
      case 'enum': {
        const label = `[${gen.values.map((x) => JSON.stringify(x)).join(', ')}]`
        return (
          `if(typeof ${v}!=="string")${this.fail('must be a string', path)};` +
          `if(!${this.ref(new Set(gen.values))}.has(${v}))${this.fail(`must be one of ${label}`, path)};`
        )
      }
      case 'object': {
        const out = this.next('o')
        return (
          `if(typeof ${v}==="string")${v}=J(${v},"{","}");` +
          `if(${v}===null||typeof ${v}!=="object"||Array.isArray(${v}))${this.fail('must be an object', path)};` +
          `let ${out};${this.object(gen.schema, gen.strict, v, out, path, gen.raw)}${v}=${out};`
        )
      }
      case 'array': {
        const { item, m } = gen
        const arr = this.next('a')
        const i = this.next('i')
        const el = this.next('e')
        let code =
          `if(!Array.isArray(${v}))${v}=${m.coerce ? 'C' : 'A'}(${v});` +
          `if(!Array.isArray(${v}))${this.fail('must be an array', path)};`
        if (m.min !== undefined) {
          code += `if(${v}.length<${m.min})${this.fail(`array must have at least ${m.min} items`, path)};`
        }
        if (m.max !== undefined) {
          code += `if(${v}.length>${m.max})${this.fail(`array exceeds maximum length of ${m.max}`, path)};`
        }
        const itemCheck = this.value(item, el, [...path, i])
        code +=
          `const ${arr}=new Array(${v}.length);` +
          `for(let ${i}=0;${i}<${v}.length;${i}++){let ${el}=${v}[${i}];` +
          (item.nullable ? `if(${el}!==null){${itemCheck}}` : itemCheck) +
          `${arr}[${i}]=${el};}` +
          `${v}=${m.dedupe ? `D(${arr})` : arr};`
        return code
      }
    }
  }

  private string(rule: FieldRule, m: Modifiers, v: string, path: Path): string {
    // trim/lowercase/uppercase are inlined; anything heavier goes through the
    // closure so the modifier order stays defined in rules.ts
    if (
      m.collapseWhitespace ||
      m.stripHtml ||
      m.escapeHtml ||
      m.slugify ||
      m.preventSql ||
      m.preventTraversal ||
      m.mask
    ) {
      return this.call(rule.base, v, path)
    }
    const p = `[${path.join(',')}]`
    let code = ''
    if (m.coerce) {
      code += `if(typeof ${v}==="number"||typeof ${v}==="boolean")${v}=String(${v});`
    }
    code += `if(typeof ${v}!=="string")${this.fail('must be a string', path)};`
    if (m.trim) code += `${v}=${v}.trim();`
    if (m.lowercase) code += `${v}=${v}.toLowerCase();`
    if (m.uppercase) code += `${v}=${v}.toUpperCase();`
    if (m.min !== undefined) {
      code += `if(${v}.length<${m.min})${this.fail(`must be at least ${m.min} characters`, path)};`
    }
    if (m.max !== undefined) {
      code += `if(${v}.length>${m.max})${this.fail(`must be at most ${m.max} characters`, path)};`
    }
    if (m.length !== undefined) {
      code += `if(${v}.length!==${m.length})E("field",${JSON.stringify(`must be exactly ${m.length} characters`)},${p},"INVALID_LENGTH");`
    }
    if (m.pattern !== undefined) {
      code += `if(!${this.ref(m.pattern)}.test(${v}))E("field",${JSON.stringify(PATTERN_FAILED)},${p},"INVALID_FORMAT",${JSON.stringify(`match ${m.pattern}`)});`
    }
    return code
  }
}

// Helpers handed to the generated function

function throwRuleError(
  kind: 'field' | 'missing' | 'strict',
  detail: string,
  path: (string | number)[],
  code?: string,
  expected?: string
): never {
  const err = new RuleError(kind, detail, code, expected)
  err.path.push(...path)
  throw err
}

function prefixAndRethrow(err: unknown, path: (string | number)[]): never {
  if (err instanceof RuleError) err.path.unshift(...path)
  else if (err instanceof ValidatorError) prefixErrors(err, path)
  throw err
}

function generate(
  schema: Record<string, string>,
  strict: boolean,
  raw: Record<string, any> | undefined,
  query: boolean
): (data: any) => any {
  const g = new Generator()
  const body = `"use strict";return function texValidate(d){let o;${g.object(schema, strict, 'd', 'o', [], raw, query)}return o}`
  const factory = new Function(
    'c',
    'x',
    'E',
    'P',
    'J',
    'A',
    'C',
    'D',
    'B',
    'R',
    body
  )
  return factory(
    g.checks,
    g.refs,
    throwRuleError,
    prefixAndRethrow,
    parseJsonString,
    normalizeArrayInput,
    coerceArrayInput,
    dedupeItems,
    coerceBoolean,
    resolveDefault
  )
}

// Assigning out["__proto__"] would set a prototype instead of a property; such
// schemas (and their nested objects) stay on the interpreted path
function mentionsProto(schema: Record<string, string>): boolean {
  return Object.keys(schema).some(
    (k) => k === '__proto__' || schema[k].includes('__proto__')
  )
}

/**
 * Builds the validator TexEngine calls for every parse. `raw` holds the
 * schema objects the rules were built from (sanitizers, refinements,
 * defaults, nested schemas); `query` converts top-level number and boolean
 * fields from text.
 */
export function compileSchema(
  schema: Record<string, string>,
  strict: boolean,
  raw?: Record<string, any>,
  query = false
): (data: any) => any {
  let validate: (data: any) => any
  try {
    if (mentionsProto(schema)) {
      return compileSchemaInterpreted(schema, strict, raw, query)
    }
    validate = generate(schema, strict, raw, query)
  } catch {
    return compileSchemaInterpreted(schema, strict, raw, query)
  }
  return (data) => {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new RuleError('input', 'Input must be a JSON object')
    }
    return validate(data)
  }
}
