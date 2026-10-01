import { generateEtag } from '@exisjs/rs'

export function generateETag(content: Buffer): string {
  return generateEtag(content)
}

export function safeSanitize(
  val: any,
  ancestors = new Set<object>(),
  path = ''
): any {
  if (val === null || val === undefined) return val
  if (typeof val === 'bigint') return val.toString()
  if (typeof val === 'symbol') return val.toString()
  if (typeof val === 'function') return undefined
  if (typeof val !== 'object') return val

  if (ancestors.has(val)) {
    return '[Circular]'
  }
  ancestors.add(val)

  try {
    if (val instanceof Error) {
      return {
        name: val.name,
        message: val.message,
        stack: val.stack,
        ...(val as any),
      }
    }

    if (val instanceof Map) {
      const obj: Record<string, any> = {}
      for (const [k, v] of val.entries()) {
        try {
          obj[String(k)] = safeSanitize(
            v,
            ancestors,
            path ? `${path}.${k}` : String(k)
          )
        } catch {
          obj[String(k)] = null
        }
      }
      return obj
    }

    if (val instanceof Set) {
      return Array.from(val).map((item, idx) =>
        safeSanitize(item, ancestors, `${path}[${idx}]`)
      )
    }

    if (
      val._bsontype === 'ObjectID' ||
      val._bsontype === 'ObjectId' ||
      val.constructor?.name === 'ObjectId' ||
      val.constructor?.name === 'ObjectID' ||
      val._bsontype === 'Decimal128' ||
      val._bsontype === 'Long' ||
      val.constructor?.name === 'Decimal128' ||
      val.constructor?.name === 'Long'
    ) {
      return val.toString()
    }

    if (val._bsontype === 'Binary' || val.constructor?.name === 'Binary') {
      return typeof val.toString === 'function' ? val.toString('base64') : val
    }

    if (
      val.constructor?.name === 'Decimal' &&
      typeof val.toFixed === 'function'
    ) {
      return val.toString()
    }

    if (typeof val.toObject === 'function') {
      try {
        return safeSanitize(
          val.toObject({ virtuals: true, getters: true }),
          ancestors,
          path
        )
      } catch {
        // fallback
      }
    }

    if (typeof val.toJSON === 'function' && !(val instanceof Date)) {
      try {
        return safeSanitize(val.toJSON(), ancestors, path)
      } catch {
        // fallback
      }
    }

    if (val instanceof Date) {
      return isNaN(val.getTime()) ? null : val.toISOString()
    }

    if (Buffer.isBuffer(val)) {
      return val.toString('utf8')
    }

    if (Array.isArray(val)) {
      return val.map((item, idx) =>
        safeSanitize(item, ancestors, `${path}[${idx}]`)
      )
    }

    const result: Record<string, any> = {}
    const keys = Object.keys(val)
    for (const key of keys) {
      if (
        key.startsWith('$__') ||
        key === '$isNew' ||
        key === '$init' ||
        key === '$errors'
      ) {
        continue
      }
      try {
        const propPath = path ? `${path}.${key}` : key
        const sanitizedChild = safeSanitize(val[key], ancestors, propPath)
        if (sanitizedChild !== undefined) {
          result[key] = sanitizedChild
        }
      } catch {
        // Omit throwing getters
      }
    }
    return result
  } finally {
    ancestors.delete(val)
  }
}

function isFastSerializable(val: any): boolean {
  if (val === null || val === undefined) return true
  const type = typeof val
  if (type === 'string' || type === 'number' || type === 'boolean') return true
  if (type !== 'object') return false
  if (val.constructor === Object) {
    for (const k in val) {
      const v = val[k]
      if (v !== null && typeof v === 'object') {
        if (v.constructor !== Object && v.constructor !== Array) return false
      } else if (
        typeof v === 'bigint' ||
        typeof v === 'function' ||
        typeof v === 'symbol'
      ) {
        return false
      }
    }
    return true
  }
  if (Array.isArray(val)) {
    for (const v of val) {
      if (v !== null && typeof v === 'object') {
        if (v.constructor !== Object && v.constructor !== Array) return false
      } else if (
        typeof v === 'bigint' ||
        typeof v === 'function' ||
        typeof v === 'symbol'
      ) {
        return false
      }
    }
    return true
  }
  return false
}

export function nativeStringify(data: unknown): Buffer | string {
  if (data === null || data === undefined) {
    return 'null'
  }

  // Fast path for primitives
  const type = typeof data
  if (type === 'string') return JSON.stringify(data)
  if (type === 'number' || type === 'boolean') return String(data)
  if (type === 'bigint') return `"${data.toString()}"`

  if (isFastSerializable(data)) {
    try {
      return JSON.stringify(data)
    } catch {
      // fallback on circular refs
    }
  }

  try {
    const sanitized = safeSanitize(data)
    return JSON.stringify(sanitized)
  } catch {
    return String(data)
  }
}
