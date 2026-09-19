import {
  escapeHtml as rsEscapeHtml,
  stripHtml as rsStripHtml,
  preventSql as rsPreventSql,
  preventTraversal as rsPreventTraversal,
  maskEmail as rsMaskEmail,
  maskString as rsMaskString,
} from '@exisjs/rs'

const safeString =
  (fn: (s: string) => string) =>
  (val: any): any => {
    if (val === null || val === undefined) return val
    return typeof val === 'string' ? fn(val) : val
  }

/**
 * ExisJS Sanitization Engine
 *
 * Offers dual-use standalone sanitization powered by native Rust
 * bindings along with pure Javascript fallback utilities for complex object
 * manipulation.
 */
export const sanitize = {
  // ─── Native Rust Sanitizers ──────────────────────────────────────────────

  escapeHtml: safeString((val: string): string => rsEscapeHtml(val)),

  stripHtml: safeString((val: string): string => rsStripHtml(val)),

  preventSql: safeString((val: string): string => {
    try {
      return rsPreventSql(val)
    } catch (e: any) {
      throw new Error(`Sanitization failed: ${e.message}`, { cause: e })
    }
  }),

  preventTraversal: safeString((val: string): string => {
    try {
      return rsPreventTraversal(val)
    } catch (e: any) {
      throw new Error(`Sanitization failed: ${e.message}`, { cause: e })
    }
  }),

  maskEmail: safeString((val: string): string => rsMaskEmail(val)),

  maskString: safeString((val: string): string => rsMaskString(val)),

  // ─── Javascript Utilities ────────────────────────────────────────────────

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
