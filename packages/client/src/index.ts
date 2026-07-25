import type { BuildProxyRouter, ClientRequestOptions } from './types'

export class ExisClientError extends Error {
  public status: number
  public url: string
  public data: any

  constructor(message: string, status: number, url: string, data: any) {
    super(message)
    this.name = 'ExisClientError'
    this.status = status
    this.url = url
    this.data = data
  }
}

export interface ClientConfig {
  baseUrl: string
  headers?: Record<string, string> | (() => Record<string, string>)
  fetch?: typeof fetch
  onRequest?: (req: RequestInit, url: string) => void | Promise<void>
  onResponse?: (res: Response, url: string) => void | Promise<void>
  onError?: (err: Error) => void | Promise<void>
}

function createProxy(path: string[], config: ClientConfig): any {
  return new Proxy(
    // The target is a function so we can invoke the proxy when it hits a method name
    // e.g. client.api.users.get(payload)
    function () {
      /* proxy target */
    },
    {
      get(target, prop: string) {
        // If we access a property, append it to the path
        return createProxy([...path, prop], config)
      },
      async apply(target, thisArg, args) {
        // The last part of the path is the HTTP method
        const method = path.pop()!.toUpperCase()
        // The rest of the path is the URL
        const urlPath = '/' + path.join('/')

        const payload = args[0]
        const options = (args[1] || {}) as ClientRequestOptions

        const url = new URL(urlPath, config.baseUrl)

        if (options.query) {
          for (const [key, val] of Object.entries(options.query)) {
            if (val !== undefined) url.searchParams.append(key, String(val))
          }
        }

        const headers = new Headers()
        if (config.headers) {
          const globalHeaders =
            typeof config.headers === 'function'
              ? config.headers()
              : config.headers
          for (const [k, v] of Object.entries(globalHeaders)) {
            headers.set(k, v)
          }
        }
        if (options.headers) {
          for (const [k, v] of Object.entries(options.headers)) {
            headers.set(k, v)
          }
        }

        if (payload && !['GET', 'HEAD'].includes(method)) {
          if (!headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json')
          }
        }

        const fetchOptions: RequestInit = {
          ...options,
          method,
          headers,
          body:
            payload && !['GET', 'HEAD'].includes(method)
              ? JSON.stringify(payload)
              : undefined,
        }

        const fetchImpl = config.fetch || globalThis.fetch

        try {
          if (config.onRequest) {
            await config.onRequest(fetchOptions, url.toString())
          }

          const res = await fetchImpl(url.toString(), fetchOptions)

          if (config.onResponse) {
            await config.onResponse(res.clone(), url.toString())
          }

          let responseData: any
          const contentType = res.headers.get('content-type') || ''

          if (contentType.includes('application/json')) {
            responseData = await res.json()
          } else {
            responseData = await res.text()
          }

          if (!res.ok) {
            throw new ExisClientError(
              `Request failed with status ${res.status}`,
              res.status,
              url.toString(),
              responseData
            )
          }

          return responseData
        } catch (err: any) {
          if (config.onError) {
            await config.onError(err)
          }
          throw err
        }
      },
    }
  )
}

/**
 * Creates a fully typed frontend client based on your Exis AppRouter.
 */
export function createClient<TRouter>(
  config: ClientConfig
): BuildProxyRouter<TRouter> {
  return createProxy([], config) as BuildProxyRouter<TRouter>
}
