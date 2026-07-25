export type HTTPMethod =
  | 'get'
  | 'post'
  | 'put'
  | 'delete'
  | 'patch'
  | 'options'
  | 'head'
  | 'connect'
  | 'trace'
  | 'query'
  | 'all'

export interface ClientRequestOptions {
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean | undefined>
  [key: string]: any // allow other fetch options like mode, credentials
}

/**
 * Replaces leading and trailing slashes.
 */
export type TrimSlash<T extends string> = T extends `/${infer U}`
  ? TrimSlash<U>
  : T extends `${infer U}/`
    ? TrimSlash<U>
    : T

/**
 * Splits a string path like "api/users" into a tuple ["api", "users"]
 */
export type SplitPath<T extends string> =
  TrimSlash<T> extends ''
    ? []
    : TrimSlash<T> extends `${infer Head}/${infer Tail}`
      ? [Head, ...SplitPath<Tail>]
      : [TrimSlash<T>]

/**
 * Converts a tuple ["api", "users"] into a deeply nested object type: { api: { users: Value } }
 */
export type PathToObject<Path extends string[], Value> = Path extends [
  infer Head,
  ...infer Tail,
]
  ? Head extends string
    ? { [K in Head]: PathToObject<Extract<Tail, string[]>, Value> }
    : never
  : Value

/**
 * Deep merges two objects together. Needed to merge `{ api: { users: ... } }` and `{ api: { posts: ... } }`.
 */
export type DeepMerge<T, U> = T extends object
  ? U extends object
    ? {
        [K in keyof T | keyof U]: K extends keyof T
          ? K extends keyof U
            ? DeepMerge<T[K], U[K]>
            : T[K]
          : K extends keyof U
            ? U[K]
            : never
      }
    : T
  : U

/**
 * Takes the raw AppRouter type and converts it into the Proxy schema.
 */
export type FlattenRouter<TRouter> = {
  [K in keyof TRouter]: TRouter[K]
}

export type BuildProxyRouter<TRouter> = UnionToIntersection<
  {
    [Path in keyof TRouter]: Path extends string
      ? PathToObject<SplitPath<Path>, RouteToClientMethods<TRouter[Path]>>
      : never
  }[keyof TRouter]
>

/**
 * Maps a route configuration (get, post, etc.) to the client methods.
 */
export type RouteToClientMethods<TRoute> = {
  [Method in keyof TRoute & HTTPMethod]: ClientMethod<TRoute[Method]>
}

export type ClientMethod<_THandler> = (
  payload?: any, // We will refine this later based on schema inference if available
  options?: ClientRequestOptions
) => Promise<any>

// Helper to convert union to intersection for merging nested objects
export type UnionToIntersection<U> = (
  U extends any ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never
