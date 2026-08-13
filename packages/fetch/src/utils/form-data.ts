import { FetchErrorCodes } from './error'

/**
 * Recursively serialise a plain object to FormData.
 * Supports nested objects, arrays, Blobs, Files, and Dates.
 */
export function toFormData(
  data: Record<string, unknown>,
  options?: {
    dots?: boolean
    indexes?: boolean | null
    metaTokens?: boolean
    maxDepth?: number
    FormDataClass?: typeof FormData
  }
): FormData {
  const FD = options?.FormDataClass ?? FormData
  const form = new FD()
  const maxDepth = options?.maxDepth ?? 100

  function buildKey(parent: string, key: string): string {
    if (!parent) return key
    return options?.dots ? `${parent}.${key}` : `${parent}[${key}]`
  }

  function visit(val: unknown, key: string, depth: number): void {
    if (depth > maxDepth) {
      throw Object.assign(
        new Error('Maximum FormData serialization depth exceeded'),
        { code: FetchErrorCodes.ERR_BAD_OPTION_VALUE }
      )
    }
    if (val === null || val === undefined) return

    if (val instanceof Blob || val instanceof File) {
      form.append(key, val as Blob)
    } else if (val instanceof Date) {
      form.append(key, val.toISOString())
    } else if (Array.isArray(val)) {
      val.forEach((item, i) => {
        const idx = options?.indexes
        const k =
          idx === null
            ? key
            : idx === true
              ? buildKey(key, String(i))
              : `${key}[]`
        visit(item, k, depth + 1)
      })
    } else if (typeof val === 'object') {
      if (options?.metaTokens && key.endsWith('{}')) {
        form.append(key, JSON.stringify(val))
      } else {
        Object.entries(val as Record<string, unknown>).forEach(([k, v]) => {
          visit(v, buildKey(key, k), depth + 1)
        })
      }
    } else {
      form.append(key, String(val))
    }
  }

  Object.entries(data).forEach(([k, v]) => visit(v, k, 0))
  return form
}
