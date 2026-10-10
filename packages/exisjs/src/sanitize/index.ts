import {
  escapeHtml,
  stripHtml,
  maskEmail,
  maskString,
  hasSqlInjection,
  hasPathTraversal,
  SQL_INJECTION_MESSAGE,
  PATH_TRAVERSAL_MESSAGE,
} from '../validator/text'

const safeString =
  (fn: (s: string) => string) =>
  (val: any): any => {
    if (val === null || val === undefined) return val
    return typeof val === 'string' ? fn(val) : val
  }

/**
 * ExisJS Sanitization Engine
 *
 * Standalone sanitizers, usable directly or composed into tex schemas via
 * `.sanitize()`.
 */
export const sanitize = {
  // ─── Security ────────────────────────────────────────────────────────────

  escapeHtml: safeString(escapeHtml),

  stripHtml: safeString(stripHtml),

  preventSql: safeString((val: string): string => {
    if (hasSqlInjection(val)) {
      throw new Error(`Sanitization failed: ${SQL_INJECTION_MESSAGE}`)
    }
    return val
  }),

  preventTraversal: safeString((val: string): string => {
    if (hasPathTraversal(val)) {
      throw new Error(`Sanitization failed: ${PATH_TRAVERSAL_MESSAGE}`)
    }
    return val
  }),

  maskEmail: safeString(maskEmail),

  maskString: safeString(maskString),

  // ─── Formatting ──────────────────────────────────────────────────────────

  trim: safeString((val) => val.trim()),

  toLowerCase: safeString((val) => val.toLowerCase()),

  toUpperCase: safeString((val) => val.toUpperCase()),

  collapseWhitespace: safeString((val) => val.replace(/\s+/g, ' ')),

  normalizeUnicode: safeString((val) => val.normalize('NFC')),

  slugify: safeString((val) =>
    val
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  ),

  truncate:
    (length: number) =>
    (val: any): any => {
      if (val === null || val === undefined || typeof val !== 'string')
        return val
      return val.length > length ? val.substring(0, length) : val
    },

  removeNonAlphanumeric: safeString((val) => val.replace(/[^a-zA-Z0-9]/g, '')),

  normalizeLineEndings: safeString((val) => val.replace(/\r\n/g, '\n')),

  // ─── Object/Array Sanitizers ───────────────────────────────────────────

  dedupe: <T>(val: T[]): T[] => Array.from(new Set(val)),

  compact: <T>(val: T[]): Exclude<T, null | undefined | ''>[] =>
    val.filter(
      (v) => v !== null && v !== undefined && (v as any) !== ''
    ) as Exclude<T, null | undefined | ''>[],

  omit:
    <T extends Record<string, any>, K extends keyof T>(keys: K[]) =>
    (val: T): Omit<T, K> => {
      const res = { ...val }
      for (const k of keys) {
        delete res[k]
      }
      return res
    },

  pick:
    <T extends Record<string, any>, K extends keyof T>(keys: K[]) =>
    (val: T): Pick<T, K> => {
      const res = {} as Pick<T, K>
      for (const k of keys) {
        if (k in val) res[k] = val[k]
      }
      return res
    },
}
