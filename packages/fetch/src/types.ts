/**
 * types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * All public type/interface declarations for the fetch client.
 * No runtime code lives here — safe to import from anywhere without
 * pulling in extra bytes at runtime.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CancelToken } from './cancel'

export type Method =
  | 'get'
  | 'GET'
  | 'post'
  | 'POST'
  | 'put'
  | 'PUT'
  | 'patch'
  | 'PATCH'
  | 'delete'
  | 'DELETE'
  | 'head'
  | 'HEAD'
  | 'options'
  | 'OPTIONS'
  | 'query'
  | 'QUERY'

export type ResponseBodyType =
  'json' | 'text' | 'blob' | 'arraybuffer' | 'stream' | 'formdata'

export type ParamsSerializerOptions = {
  /** Custom encoder applied to each key and value string. */
  encode?: (param: string) => string
  /** Fully replace the default serializer for the entire params object. */
  serialize?: (
    params: Record<string, unknown>,
    options?: ParamsSerializerOptions
  ) => string
  /**
   * How array indexes are rendered:
   * null  → no brackets    (arr: 1, arr: 2)
   * false → empty brackets (arr[]: 1, arr[]: 2)   ← default
   * true  → with index     (arr[0]: 1, arr[1]: 2)
   */
  indexes?: boolean | null
  /** Maximum nesting depth. Payloads deeper than this throw ERR_BAD_OPTION_VALUE. Default: 100 */
  maxDepth?: number
}

/** Transfer progress event for uploads/downloads. */
export type TransferProgressEvent = {
  loaded: number
  total?: number
  /** Upload/download ratio 0..1 (only when Content-Length is known). */
  progress?: number
  /** Bytes transferred since the previous event (delta). */
  bytes: number
  /** Estimated seconds remaining. */
  estimated?: number
  /** Transfer speed in bytes/sec. */
  rate?: number
  upload?: boolean
  download?: boolean
}

export type TransformRequest<D = any> = (
  data: D,
  headers: Record<string, string>
) => any

export type TransformResponse<T = any> = (data: T) => any

export interface BasicCredentials {
  username: string
  password: string
}

export interface ProxyConfig {
  protocol?: string
  host: string
  port?: number
  auth?: BasicCredentials
}

/** Result shape returned by a mock adapter (see `createMockAdapter` in helpers.ts). */
export interface AdapterResult<T = any> {
  data: T
  status?: number
  statusText?: string
  headers?: Record<string, string>
}

export interface FetchRequestConfig<D = any> {
  // ── Core ────────────────────────────────────────────────────────────────
  url?: string
  method?: Method
  baseURL?: string
  headers?: Record<string, string>

  // ── Params ──────────────────────────────────────────────────────────────
  params?: Record<string, unknown>
  paramsSerializer?: ParamsSerializerOptions

  // ── Body ────────────────────────────────────────────────────────────────
  data?: D
  /** @deprecated Use `data`. Kept for legacy compatibility. */
  body?: D

  // ── Transforms ──────────────────────────────────────────────────────────
  /** One or more functions to transform the request body before sending. */
  transformRequest?: TransformRequest<D> | TransformRequest<D>[]
  /** One or more functions to transform the response data before resolving. */
  transformResponse?: TransformResponse | TransformResponse[]

  // ── Response ────────────────────────────────────────────────────────────
  responseType?: ResponseBodyType
  responseEncoding?: string

  // ── Auth ────────────────────────────────────────────────────────────────
  /** HTTP Basic auth — automatically sets the Authorization header. */
  auth?: BasicCredentials

  // ── Behaviour ───────────────────────────────────────────────────────────
  timeout?: number
  timeoutErrorMessage?: string
  withCredentials?: boolean
  validateStatus?: ((status: number) => boolean) | null
  maxRedirects?: number
  maxContentLength?: number
  maxBodyLength?: number
  decompress?: boolean

  // ── XSRF ────────────────────────────────────────────────────────────────
  xsrfCookieName?: string
  xsrfHeaderName?: string
  /**
   * Controls whether the XSRF header is sent.
   * undefined (default) → same-origin requests only
   * true                → always
   * false               → never
   * function            → called per-request to decide
   */
  withXSRFToken?:
    boolean | ((config: FetchRequestConfig<any>) => boolean | undefined)

  // ── Progress ────────────────────────────────────────────────────────────
  onUploadProgress?: (event: TransferProgressEvent) => void
  onDownloadProgress?: (event: TransferProgressEvent) => void

  // ── Rate limiting ────────────────────────────────────────────────────────
  /** [uploadBytesPerSec, downloadBytesPerSec] (reserved — passed through) */
  maxRate?: [number, number?]

  // ── Proxy ────────────────────────────────────────────────────────────────
  proxy?: ProxyConfig | false

  // ── Cancellation ────────────────────────────────────────────────────────
  signal?: AbortSignal
  cancelToken?: CancelToken

  // ── Form serialization ───────────────────────────────────────────────────
  formSerializer?: {
    visitor?: (
      value: unknown,
      key: string,
      path: (string | number)[],
      helpers: unknown
    ) => unknown
    dots?: boolean
    metaTokens?: boolean
    indexes?: boolean | null
    /** Max nesting depth. Default: 100. Set Infinity to disable. */
    maxDepth?: number
  }

  // ── Environment (custom fetch / FormData) ───────────────────────────────
  env?: {
    FormData?: typeof FormData
    /** Provide a custom fetch implementation (e.g. SvelteKit's fetch, Tauri's fetch). */
    fetch?: typeof globalThis.fetch
  }

  // ── Transitional (legacy compatibility flags) ───────────────────────────
  transitional?: {
    /** Silently return null when JSON.parse fails. Default: true. */
    silentJSONParsing?: boolean
    /** Try JSON parse even when responseType is not set. Default: true. */
    forcedJSONParsing?: boolean
    /**
     * Throw ETIMEDOUT (not ECONNABORTED) on timeout.
     * Default: false.
     */
    clarifyTimeoutError?: boolean
  }

  // ── Retry ────────────────────────────────────────────────────────────────
  retries?: number
  retryDelay?: number
  retryOn?: number[]

  // ── Caching ─────────────────────────────────────────────────────────────
  /**
   * Cache successful GET/HEAD responses in memory.
   * `true` uses the default 60s TTL; pass `{ ttl }` (ms) to customise it.
   */
  cache?: boolean | { ttl?: number }

  // ── De-duplication ──────────────────────────────────────────────────────
  /**
   * If a request with the same method + URL + params + body is already
   * in flight, reuse its promise instead of firing a second network call.
   */
  dedupe?: boolean

  // ── Mock adapter ────────────────────────────────────────────────────────
  /**
   * When set, requests are resolved by this function instead of hitting
   * the network. Use `createMockAdapter()` (helpers.ts) to build one from
   * a route table.
   */
  adapter?: (
    config: FetchRequestConfig<D>
  ) => Promise<AdapterResult<any>> | AdapterResult<any>

  // ── Raw RequestInit passthrough ──────────────────────────────────────────
  fetchOptions?: Omit<RequestInit, 'method' | 'headers' | 'body' | 'signal'>
}

export interface FetchResponse<T = any, D = any> {
  data: T
  status: number
  statusText: string
  headers: Record<string, string>
  config: FetchRequestConfig<D>
  request?: Request
  /** True when this response was served from the in-memory cache. */
  cached?: boolean
}

export interface FetchError<T = any, D = any> extends Error {
  config: FetchRequestConfig<D>
  code?: string
  request?: Request
  response?: FetchResponse<T, D>
  isFetchError: boolean
  isTimeout: boolean
  isNetworkError: boolean
  isCancel: boolean
  validationErrors?: { path: string; message: string }[]
  toJSON(): object
}

export interface InterceptorOptions {
  /** Run this request interceptor synchronously (skip the micro-task queue). */
  synchronous?: boolean
  /** Only run this interceptor when this function returns true. */
  runWhen?: (config: FetchRequestConfig<any>) => boolean
}

export type InterceptorHandler<V> = {
  fulfilled?: ((v: V) => V | Promise<V>) | null
  rejected?: ((e: unknown) => unknown) | null
  options?: InterceptorOptions
}

export interface InterceptorManager<V> {
  use(
    onFulfilled?: ((value: V) => V | Promise<V>) | null,
    onRejected?: ((error: unknown) => unknown) | null,
    options?: InterceptorOptions
  ): number
  eject(id: number): void
  clear(): void
  forEach(fn: (h: InterceptorHandler<V>) => void): void
}

export interface LoggerOptions {
  logRequests?: boolean
  logResponses?: boolean
  logErrors?: boolean
  /** Defaults to `console`. Pass a custom object to redirect log output. */
  logger?: Pick<Console, 'log' | 'error'>
}

export interface MockRoute {
  method?: Method
  /** Exact string match or a RegExp tested against the full resolved URL. */
  url: string | RegExp
  response: (config: FetchRequestConfig) => unknown | Promise<unknown>
  status?: number
  statusText?: string
  headers?: Record<string, string>
  /** Optional artificial latency in ms, useful for testing loading states. */
  delay?: number
}
