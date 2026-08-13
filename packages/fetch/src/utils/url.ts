import type { ParamsSerializerOptions, FetchRequestConfig } from '../types'
import { FetchErrorCodes } from './error'

export function buildURL(
  base: string | undefined,
  path: string,
  params: Record<string, unknown> | undefined,
  serializer?: ParamsSerializerOptions
): string {
  const url =
    base && !/^https?:\/\//i.test(path)
      ? `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
      : path

  if (!params || !Object.keys(params).length) return url

  let queryString: string

  if (serializer?.serialize) {
    queryString = serializer.serialize(params, serializer)
  } else {
    const qs = new URLSearchParams()
    const encode = serializer?.encode ?? ((v: string) => v)
    const indexes = serializer?.indexes ?? false
    const maxDepth = serializer?.maxDepth ?? 100

    function appendParam(key: string, val: unknown, depth: number): void {
      if (depth > maxDepth)
        throw new Error(FetchErrorCodes.ERR_BAD_OPTION_VALUE)
      if (val === null || val === undefined) return
      if (Array.isArray(val)) {
        val.forEach((item, i) => {
          const k =
            indexes === null ? key : indexes ? `${key}[${i}]` : `${key}[]`
          appendParam(k, item, depth + 1)
        })
      } else if (typeof val === 'object' && !(val instanceof Date)) {
        Object.entries(val as Record<string, unknown>).forEach(([k, v]) => {
          appendParam(`${key}[${k}]`, v, depth + 1)
        })
      } else {
        const strVal = val instanceof Date ? val.toISOString() : String(val)
        qs.append(encode(key), encode(strVal))
      }
    }

    Object.entries(params).forEach(([k, v]) => appendParam(k, v, 0))
    queryString = qs.toString()
  }

  return queryString
    ? `${url}${url.includes('?') ? '&' : '?'}${queryString}`
    : url
}

/** Builds a stable cache/dedupe key from method + URL + (optionally) body. */
export function getRequestKey(
  cfg: FetchRequestConfig,
  includeData: boolean
): string {
  const method = (cfg.method ?? 'get').toUpperCase()
  const url = buildURL(
    cfg.baseURL,
    cfg.url ?? '',
    cfg.params as Record<string, unknown>,
    cfg.paramsSerializer
  )
  if (!includeData) return `${method} ${url}`

  let dataKey = ''
  const body = cfg.data ?? cfg.body
  try {
    if (body !== undefined && body !== null) {
      if (typeof body !== 'object') {
        dataKey = String(body)
      } else if (!(body instanceof FormData) && !(body instanceof Blob)) {
        dataKey = JSON.stringify(body)
      }
    }
  } catch {
    // Non-serialisable body — fall back to method+URL only.
  }
  return `${method} ${url}::${dataKey}`
}
