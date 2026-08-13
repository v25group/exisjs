import type { FetchError } from '../types'

/** True if the value is a FetchError. */
export function isFetchError(payload: unknown): payload is FetchError {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as FetchError).isFetchError === true
  )
}

/** Run requests in parallel. */
export function all<T>(values: (T | Promise<T>)[]): Promise<T[]> {
  return Promise.all(values)
}

/** Spread an array of results into named arguments. */
export function spread<T, R>(callback: (...args: T[]) => R): (arr: T[]) => R {
  return (arr) => callback(...arr)
}
