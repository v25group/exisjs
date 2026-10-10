// Schema code generator.
//
// Turns a tex schema into one straight-line JavaScript function, the way Ajv
// does for JSON Schema: type checks are inlined, nested objects and arrays
// become nested blocks and loops, and the result is built as a single object
// literal. V8 optimizes this far better than a loop over check closures.
//
// Rules that are rare or involved (unions, records, passwords, text
// sanitizers...) are not inlined; the generated code calls the closure from
// rules.ts for them, so behavior is defined in exactly one place.
//
// Only schema authors' data reaches the generated source, and every string
// from it is embedded with JSON.stringify. Request data is never part of the
// code. Where `new Function` is unavailable (strict CSP, some edge runtimes)
// the closure-based validator from rules.ts is used instead.

import {
  RuleError,
  EMAIL,
  compileRule,
  compileSchema as compileSchemaInterpreted,
  dedupeItems,
  normalizeArrayInput,
  parseJsonString,
  toLegacyError,
  type FieldRule,
  type Modifiers,
} from './rules'

type Path = string[] // JS source fragments: '"items"', 'i3', ...

class Generator {
  private id = 0
  /** Closures called from generated code as c[n](value) */
  readonly checks: ((v: any) => any)[] = []
  /** Regexes and Sets referenced from generated code as x[n] */
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

  /** Validates the object in `src` and assigns the cleaned copy to `dest` */
  object(
    schema: Record<string, string>,
    strict: boolean,
    src: string,
    dest: string,
    path: Path
  ): string {
    const keys = Object.keys(schema)
    const rules = keys.map((k) => compileRule(schema[k]))
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

      const canBeAbsent = rule.optional && rule.defaultValue === undefined
      if (canBeAbsent) anyAbsent = true

      let body = `let ${v}=${src}[${key}];`
      let onMissing: string
      if (rule.defaultValue !== undefined) {
        onMissing = `${v}=${JSON.stringify(rule.defaultValue)};`
      } else if (rule.optional) {
        onMissing = ''
      } else {
        onMissing = `E("missing","",[${fieldPath.join(',')}]);`
      }
      const check = `${this.value(rule, v, fieldPath)}${r}=${v};`
      const present = canBeAbsent
        ? `if(${v}!==undefined&&${v}!==null){${check}}`
        : `if(${v}===undefined||${v}===null){${onMissing}}${check}`
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
          rules[i].optional && rules[i].defaultValue === undefined
        code += optional ? `if(${results[i]}!==undefined)${assign}` : assign
      }
    }
    return code
  }

  /** Validates the non-null value held in variable `v`, updating it in place */
  private value(rule: FieldRule, v: string, path: Path): string {
    const gen = rule.gen
    if (!gen) return this.delegate(rule, v, path)

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
        if (m.min !== undefined) {
          code += `if(${v}<${m.min})${this.fail(`must be >= ${m.min}`, path)};`
        }
        if (m.max !== undefined) {
          code += `if(${v}>${m.max})${this.fail(`must be <= ${m.max}`, path)};`
        }
        return code
      }
      case 'boolean': {
        let code = ''
        if (gen.m.coerce) {
          code += `if(${v}==="true"||${v}==="1"||${v}===1)${v}=true;else if(${v}==="false"||${v}==="0"||${v}===0)${v}=false;`
        }
        return (
          code +
          `if(typeof ${v}!=="boolean")${this.fail('must be a boolean', path)};`
        )
      }
      case 'email': {
        if (gen.m.mask) return this.delegate(rule, v, path)
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
          `let ${out};${this.object(gen.schema, false, v, out, path)}${v}=${out};`
        )
      }
      case 'array': {
        const { item, m } = gen
        const arr = this.next('a')
        const i = this.next('i')
        const el = this.next('e')
        let code =
          `if(!Array.isArray(${v}))${v}=A(${v});` +
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
      return this.delegate(rule, v, path)
    }
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
    return code
  }

  private delegate(rule: FieldRule, v: string, path: Path): string {
    this.checks.push(rule.check)
    const n = this.checks.length - 1
    return `try{${v}=c[${n}](${v})}catch(e){P(e,[${path.join(',')}])}`
  }
}

// Helpers handed to the generated function

function throwRuleError(
  kind: 'field' | 'missing' | 'strict',
  detail: string,
  path: (string | number)[]
): never {
  const err = new RuleError(kind, detail)
  err.path.push(...path)
  throw err
}

function prefixAndRethrow(err: unknown, path: (string | number)[]): never {
  if (err instanceof RuleError) err.path.unshift(...path)
  throw err
}

function generate(
  schema: Record<string, string>,
  strict: boolean
): (data: any) => any {
  const g = new Generator()
  const body = `"use strict";return function texValidate(d){let o;${g.object(schema, strict, 'd', 'o', [])}return o}`
  const factory = new Function('c', 'x', 'E', 'P', 'J', 'A', 'D', body)
  return factory(
    g.checks,
    g.refs,
    throwRuleError,
    prefixAndRethrow,
    parseJsonString,
    normalizeArrayInput,
    dedupeItems
  )
}

// Assigning out["__proto__"] would set a prototype instead of a property; such
// schemas (and their nested objects) stay on the interpreted path
function mentionsProto(schema: Record<string, string>): boolean {
  return Object.keys(schema).some(
    (k) => k === '__proto__' || schema[k].includes('__proto__')
  )
}

/** Builds the validator TexEngine calls for every parse */
export function compileSchema(
  schema: Record<string, string>,
  strict: boolean
): (data: any) => any {
  let validate: (data: any) => any
  try {
    if (mentionsProto(schema)) return compileSchemaInterpreted(schema, strict)
    validate = generate(schema, strict)
  } catch {
    return compileSchemaInterpreted(schema, strict)
  }
  return (data) => {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Input must be a JSON object')
    }
    try {
      return validate(data)
    } catch (err) {
      throw err instanceof RuleError ? toLegacyError(err) : err
    }
  }
}
