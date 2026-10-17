// String transforms shared by tex rules and the standalone `sanitize` API

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const HTML_SPECIAL = /[&<>"']/g

export function escapeHtml(s: string): string {
  return s.replace(HTML_SPECIAL, (c) => HTML_ESCAPES[c])
}

const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g
// Their content is code, not text; an unclosed element runs to the end
const HTML_CODE_ELEMENT = /<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi
// A tag starts with a letter, '/', '!' or '?'; "a < b" is text
const HTML_TAG = /<[a-zA-Z/!?][^>]*(?:>|$)/g

/** Removes tags, comments, and script/style elements with their content. */
export function stripHtml(s: string): string {
  if (!s.includes('<')) return s
  return s
    .replace(HTML_COMMENT, '')
    .replace(HTML_CODE_ELEMENT, '')
    .replace(HTML_TAG, '')
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ')
}

// "Café" -> "cafe": accented letters keep their base letter
const COMBINING_MARKS = /[\u0300-\u036f]/g

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function maskEmail(s: string): string {
  const parts = s.split('@')
  if (parts.length !== 2) return s
  const local = parts[0]
  return `${local.length > 2 ? local.slice(0, 2) + '***' : '***'}@${parts[1]}`
}

export function maskString(s: string): string {
  return s.length > 4 ? `${s.slice(0, 2)}****${s.slice(-2)}` : '****'
}

// Coarse deny-lists; parameterized queries and path.resolve checks are the
// real defenses. These only catch the most common probe strings.
const SQL_PATTERNS = ["' or 1=1", ';--', 'drop table', 'union select']

export function hasSqlInjection(s: string): boolean {
  const lower = s.toLowerCase()
  return SQL_PATTERNS.some((p) => lower.includes(p))
}

/** A `..` path segment (also percent-encoded or with `\`), or a NUL byte. */
export function hasPathTraversal(s: string): boolean {
  let v = s
  // %2e%2e%2f, and double-encoded %252e%252e%252f
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(v); i++) {
    try {
      v = decodeURIComponent(v)
    } catch {
      break
    }
  }
  if (v.includes('\0')) return true
  const path = v.replace(/\\/g, '/')
  return path.split('/').includes('..') || path.includes('/etc/passwd')
}

export const SQL_INJECTION_MESSAGE = 'Potential SQL Injection detected'
export const PATH_TRAVERSAL_MESSAGE = 'Path traversal attempt detected'
