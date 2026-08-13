import type { FetchRequestConfig } from '../types'
import type { FetchClient } from '../lib/index'

export interface ClientRequestOptions extends Omit<
  FetchRequestConfig,
  'url' | 'method' | 'data' | 'body'
> {
  query?: Record<string, string | number | boolean | undefined>
  params?: Record<string, string | number | boolean>
}

export type BuildProxyRouter<TRouter> = {
  [K in keyof TRouter]: TRouter[K] extends (...args: any[]) => any
    ? (
        payload?: Parameters<TRouter[K]>[0],
        options?: ClientRequestOptions
      ) => Promise<ReturnType<TRouter[K]>>
    : BuildProxyRouter<TRouter[K]>
}

export interface ClientConfig {
  baseUrl: string
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>)
  client?: FetchClient
  onRequest?: (config: FetchRequestConfig) => void | Promise<void>
  onResponse?: (res: any) => void | Promise<void>
  onError?: (err: Error) => void | Promise<void>
}
