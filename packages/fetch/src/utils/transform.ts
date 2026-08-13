import type { TransformRequest, TransformResponse } from '../types'

export function applyTransformRequest(
  data: unknown,
  headers: Record<string, string>,
  transforms: TransformRequest | TransformRequest[]
): unknown {
  const fns = Array.isArray(transforms) ? transforms : [transforms]
  return fns.reduce((acc, fn) => fn(acc as never, headers), data)
}

export function applyTransformResponse(
  data: unknown,
  transforms: TransformResponse | TransformResponse[]
): unknown {
  const fns = Array.isArray(transforms) ? transforms : [transforms]
  return fns.reduce((acc, fn) => fn(acc as never), data)
}
