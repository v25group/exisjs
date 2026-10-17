import type { ValidationErrorDescriptor } from './types'

export function getNestedValue(obj: any, path: string): any {
  if (!obj || typeof obj !== 'object' || !path) return undefined
  if (path in obj) return obj[path]
  try {
    const keys = path.replace(/\[(\w+)\]/g, '.$1').split('.')
    let curr = obj
    for (const k of keys) {
      if (curr === undefined || curr === null) return undefined
      curr = curr[k]
    }
    return curr
  } catch {
    return undefined
  }
}

export function formatReceivedValue(val: any): string {
  if (val === undefined) return 'undefined'
  if (val === null) return 'null'
  if (typeof val === 'string') return JSON.stringify(val)
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) {
    try {
      const str = JSON.stringify(val)
      return str.length > 30 ? `Array(${val.length})` : str
    } catch {
      return `Array(${val.length})`
    }
  }
  if (typeof val === 'object') {
    try {
      const str = JSON.stringify(val)
      return str.length > 30 ? '[object Object]' : str
    } catch {
      return '[object Object]'
    }
  }
  return String(val)
}

// Field names whose values must not appear in logs or responses
// Connection settings (DATABASE_URL, REDIS_URI, SENTRY_DSN, MONGO_CONNECTION...)
// usually carry a password, so the whole value is hidden
const SENSITIVE_FIELD =
  /pass(word|wd|phrase)?|secret|token|authorization|api[-_]?key|credential|card|cvv|cvc|ssn|\bpin\b|otp|_(url|uri|dsn)$|^dsn$|connection|conn_?str/i

export function isSensitiveField(name: string): boolean {
  return SENSITIVE_FIELD.test(name)
}

// scheme://user:password@host -> scheme://user:***@host
const URL_CREDENTIALS =
  /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/?#@:"']*:)[^\s/?#@"']+@/gi

/** Hides the password of any `scheme://user:password@host` inside a value. */
export function maskCredentials<T>(value: T): T {
  return typeof value === 'string'
    ? (value.replace(URL_CREDENTIALS, '$1***@') as unknown as T)
    : value
}

/** The value that is safe to show in logs and responses for a field. */
export function redactReceived(field: string, value: string): string {
  return isSensitiveField(field) ? '[Redacted]' : maskCredentials(value)
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production'

export class ValidatorError extends Error {
  public readonly errors: ValidationErrorDescriptor[]
  public httpPart?: string
  public routePath?: string
  public routeMethod?: string
  public received?: any

  constructor(errors: ValidationErrorDescriptor[]) {
    // A rejected request is routine; in production its stack (always inside
    // the validator) costs more than the rest of the failure path together
    const limit = Error.stackTraceLimit
    if (IS_PRODUCTION) Error.stackTraceLimit = 0
    super(
      'Validation Error: ' +
        errors.map((e) => `${e.path}: ${e.message}`).join(', ')
    )
    Error.stackTraceLimit = limit
    this.name = 'ValidatorError'
    // Received values end up in logs, error responses and (for tex.env) the
    // startup crash output, so credentials are masked at the source
    this.errors = errors.map((e) =>
      e.received === undefined
        ? e
        : { ...e, received: redactReceived(e.path, e.received) }
    )
  }
}
