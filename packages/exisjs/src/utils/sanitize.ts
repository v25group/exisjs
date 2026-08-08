/**
 * ExisJS Sanitize Engine
 *
 * A collection of pure functions for transforming data before business logic validation.
 * These are designed to be composable with the `ValidatorType.sanitize()` method.
 */

export const sanitize = {
  // ─── String Sanitizers ────────────────────────────────────────────────────────

  trim: (val: string): string => val.trim(),

  toLowerCase: (val: string): string => val.toLowerCase(),

  toUpperCase: (val: string): string => val.toUpperCase(),

  collapseWhitespace: (val: string): string => val.replace(/\s+/g, ' '),

  stripHtml: (val: string): string => val.replace(/<[^>]*>?/gm, ''),

  escapeHtml: (val: string): string =>
    val.replace(/[&<>"']/g, (m) => {
      const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }
      return map[m] || m
    }),

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

  // ─── Number Sanitizers ────────────────────────────────────────────────────────

  round: (val: number): number => Math.round(val),

  clamp:
    (min: number, max: number) =>
    (val: number): number =>
      Math.max(min, Math.min(max, val)),

  defaultIfNaN:
    (fallback: number) =>
    (val: number): number =>
      Number.isNaN(val) ? fallback : val,

  // ─── Date Sanitizers ──────────────────────────────────────────────────────────

  normalizeToIsoString: (val: Date): string => val.toISOString(),

  stripTime: (val: Date): Date => {
    const d = new Date(val)
    d.setHours(0, 0, 0, 0)
    return d
  },

  // ─── Array Sanitizers ─────────────────────────────────────────────────────────

  dedupe: <T>(val: T[]): T[] => Array.from(new Set(val)),

  compact: <T>(val: T[]): Exclude<T, null | undefined | ''>[] =>
    val.filter(
      (v) => v !== null && v !== undefined && (v as any) !== ''
    ) as Exclude<T, null | undefined | ''>[],

  trimElements: (val: string[]): string[] =>
    val.map((v) => (typeof v === 'string' ? v.trim() : v)),

  limitLength:
    <T>(length: number) =>
    (val: T[]): T[] =>
      val.slice(0, length),

  // ─── Object Sanitizers ────────────────────────────────────────────────────────

  stripUnknownKeys:
    <T extends Record<string, any>>(allowedKeys: (keyof T)[]) =>
    (val: T): T => {
      const res = {} as Partial<T>
      for (const key of allowedKeys) {
        if (key in val) res[key] = val[key]
      }
      return res as T
    },

  deepTrimStringValues: <T extends Record<string, any>>(val: T): T => {
    const walk = (obj: any): any => {
      if (typeof obj === 'string') return obj.trim()
      if (Array.isArray(obj)) return obj.map(walk)
      if (obj !== null && typeof obj === 'object') {
        const res: any = {}
        for (const k in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, k)) {
            res[k] = walk(obj[k])
          }
        }
        return res
      }
      return obj
    }
    return walk(val)
  },

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
