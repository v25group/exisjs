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

export class ValidatorError extends Error {
  public readonly errors: ValidationErrorDescriptor[]
  public httpPart?: string
  public routePath?: string
  public routeMethod?: string
  public received?: any

  constructor(errors: ValidationErrorDescriptor[]) {
    super(
      'Validation Error: ' +
        errors.map((e) => `${e.path}: ${e.message}`).join(', ')
    )
    this.name = 'ValidatorError'
    this.errors = errors
  }
}
