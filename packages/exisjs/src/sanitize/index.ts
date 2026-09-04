import {
  escapeHtml as rsEscapeHtml,
  stripHtml as rsStripHtml,
  preventSql as rsPreventSql,
  preventTraversal as rsPreventTraversal,
  maskEmail as rsMaskEmail,
  maskString as rsMaskString,
} from '@exisjs/rs'

/**
 * ExisJS Sanitization Engine
 *
 * Offers dual-use standalone sanitization powered by native Rust
 * bindings along with pure Javascript fallback utilities for complex object
 * manipulation.
 */
export const sanitize = {
  // ─── Native Rust Sanitizers ──────────────────────────────────────────────

  escapeHtml: (val: string): string => rsEscapeHtml(val),

  stripHtml: (val: string): string => rsStripHtml(val),

  preventSql: (val: string): string => {
    try {
      return rsPreventSql(val)
    } catch (e: any) {
      throw new Error(`Sanitization failed: ${e.message}`, { cause: e })
    }
  },

  preventTraversal: (val: string): string => {
    try {
      return rsPreventTraversal(val)
    } catch (e: any) {
      throw new Error(`Sanitization failed: ${e.message}`, { cause: e })
    }
  },

  maskEmail: (val: string): string => rsMaskEmail(val),

  maskString: (val: string): string => rsMaskString(val),

  // ─── Javascript Utilities ────────────────────────────────────────────────

  trim: (val: string): string => val.trim(),

  toLowerCase: (val: string): string => val.toLowerCase(),

  toUpperCase: (val: string): string => val.toUpperCase(),

  collapseWhitespace: (val: string): string => val.replace(/\s+/g, ' '),

  normalizeUnicode: (val: string): string => val.normalize('NFC'),

  slugify: (val: string): string =>
    val
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, ''),

  truncate:
    (length: number) =>
    (val: string): string =>
      val.length > length ? val.substring(0, length) : val,

  removeNonAlphanumeric: (val: string): string =>
    val.replace(/[^a-zA-Z0-9]/g, ''),

  normalizeLineEndings: (val: string): string => val.replace(/\r\n/g, '\n'),

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
