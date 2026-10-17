import {
  escapeHtml,
  stripHtml,
  collapseWhitespace,
  slugify,
  maskEmail,
  maskString,
  hasSqlInjection,
  hasPathTraversal,
  SQL_INJECTION_MESSAGE,
  PATH_TRAVERSAL_MESSAGE,
} from '../validator/text'

// Each sanitizer passes values of other types through unchanged, so it is
// safe on optional and nullable fields
const onString =
  (fn: (s: string) => string) =>
  (val: any): any =>
    typeof val === 'string' ? fn(val) : val

const onArray =
  <R>(fn: (arr: any[]) => R) =>
  (val: any): any =>
    Array.isArray(val) ? fn(val) : val

const isPlainObject = (val: any): val is Record<string, any> =>
  val !== null && typeof val === 'object' && !Array.isArray(val)

// C0/C1 control characters except tab, line feed and carriage return, plus
// the bidirectional overrides used to disguise text ("Trojan Source")
const CONTROL_CHARS = new RegExp(
  // eslint-disable-next-line no-control-regex
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u202A-\\u202E\\u2066-\\u2069]',
  'g'
)

/**
 * ExisJS Sanitization Engine
 *
 * Standalone sanitizers, usable directly or composed into tex schemas via
 * `.sanitize()`. Sanitizers run before validation; one that throws (such as
 * `preventSql`) turns into a 400 validation error for that field.
 */
export const sanitize = {
  // ─── Security ────────────────────────────────────────────────────────────

  /** Escapes `& < > " '` so the text is safe inside HTML. */
  escapeHtml: onString(escapeHtml),

  /** Removes tags, comments, and `<script>` / `<style>` with their content. */
  stripHtml: onString(stripHtml),

  /** Removes invisible control characters and bidirectional overrides. */
  stripControlChars: onString((val) => val.replace(CONTROL_CHARS, '')),

  /**
   * Rejects common SQL injection probes. A coarse filter: use parameterized
   * queries, which this does not replace.
   */
  preventSql: onString((val) => {
    if (hasSqlInjection(val)) {
      throw new Error(`Sanitization failed: ${SQL_INJECTION_MESSAGE}`)
    }
    return val
  }),

  /** Rejects `..` path segments (also percent-encoded) and NUL bytes. */
  preventTraversal: onString((val) => {
    if (hasPathTraversal(val)) {
      throw new Error(`Sanitization failed: ${PATH_TRAVERSAL_MESSAGE}`)
    }
    return val
  }),

  maskEmail: onString(maskEmail),

  maskString: onString(maskString),

  // ─── Formatting ──────────────────────────────────────────────────────────

  trim: onString((val) => val.trim()),

  toLowerCase: onString((val) => val.toLowerCase()),

  toUpperCase: onString((val) => val.toUpperCase()),

  collapseWhitespace: onString(collapseWhitespace),

  normalizeUnicode: onString((val) => val.normalize('NFC')),

  /** Trims and lowercases an email address. */
  normalizeEmail: onString((val) => val.trim().toLowerCase()),

  slugify: onString(slugify),

  /** Shortens to `length` UTF-16 units without splitting an emoji in two. */
  truncate: (length: number) =>
    onString((val) => {
      if (val.length <= length) return val
      let end = length
      const code = val.charCodeAt(end - 1)
      if (code >= 0xd800 && code <= 0xdbff) end-- // high surrogate
      return val.slice(0, end)
    }),

  removeNonAlphanumeric: onString((val) => val.replace(/[^a-zA-Z0-9]/g, '')),

  /** `\r\n` and lone `\r` become `\n`. */
  normalizeLineEndings: onString((val) => val.replace(/\r\n?/g, '\n')),

  // ─── Numbers ─────────────────────────────────────────────────────────────

  /** Rounds to `decimals` places (default 0). */
  round:
    (decimals = 0) =>
    (val: any): any => {
      if (typeof val !== 'number') return val
      const f = 10 ** decimals
      return Math.round(val * f) / f
    },

  /** Limits a number to `min`..`max`. */
  clamp:
    (min: number, max: number) =>
    (val: any): any =>
      typeof val === 'number' ? Math.min(max, Math.max(min, val)) : val,

  // ─── Arrays ──────────────────────────────────────────────────────────────

  dedupe: onArray((val) => Array.from(new Set(val))),

  /** Removes `null`, `undefined` and `''` items. */
  compact: onArray((val) =>
    val.filter((v) => v !== null && v !== undefined && v !== '')
  ),

  /** Trims every string item. */
  trimElements: onArray((val) =>
    val.map((v) => (typeof v === 'string' ? v.trim() : v))
  ),

  /** Keeps the first `length` items. */
  limitLength: (length: number) => onArray((val) => val.slice(0, length)),

  // ─── Objects ─────────────────────────────────────────────────────────────

  omit:
    <T extends Record<string, any>, K extends keyof T>(keys: K[]) =>
    (val: T): Omit<T, K> => {
      if (!isPlainObject(val)) return val
      const res = { ...val }
      for (const k of keys) delete res[k]
      return res
    },

  /** Keeps only `keys` the object itself has (never inherited ones). */
  pick:
    <T extends Record<string, any>, K extends keyof T>(keys: K[]) =>
    (val: T): Pick<T, K> => {
      if (!isPlainObject(val)) return val
      const res = {} as Pick<T, K>
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(val, k)) res[k] = val[k]
      }
      return res
    },

  /** Trims every string in a nested object or array. */
  deepTrim: <T>(val: T): T => {
    const walk = (v: any): any => {
      if (typeof v === 'string') return v.trim()
      if (Array.isArray(v)) return v.map(walk)
      if (isPlainObject(v)) {
        const res: Record<string, any> = {}
        for (const k of Object.keys(v)) {
          if (k !== '__proto__') res[k] = walk(v[k])
        }
        return res
      }
      return v
    }
    return walk(val)
  },
}
