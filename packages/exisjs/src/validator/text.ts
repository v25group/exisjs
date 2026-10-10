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

// Drops everything between '<' and '>' (an unterminated tag runs to the end)
export function stripHtml(s: string): string {
  let out = ''
  let inTag = false
  for (const c of s) {
    if (c === '<') inTag = true
    else if (c === '>') inTag = false
    else if (!inTag) out += c
  }
  return out
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ')
}

export function slugify(s: string): string {
  return s
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

export function hasPathTraversal(s: string): boolean {
  return s.includes('../') || s.includes('..\\') || s.includes('/etc/passwd')
}

export const SQL_INJECTION_MESSAGE = 'Potential SQL Injection detected'
export const PATH_TRAVERSAL_MESSAGE = 'Path traversal attempt detected'
