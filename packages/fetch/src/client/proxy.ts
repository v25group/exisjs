import type { FetchRequestConfig } from '../types'
import { FetchClient } from '../lib/index'
import type {
  ClientConfig,
  ClientRequestOptions,
  BuildProxyRouter,
} from './types'

export function createProxy(
  path: string[],
  config: ClientConfig,
  httpClient: FetchClient
): any {
  return new Proxy(
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    function () {},
    {
      get(target, prop: string) {
        return createProxy([...path, prop], config, httpClient)
      },
      async apply(target, thisArg, args) {
        const lastSegment = path[path.length - 1]
        const isMethod = [
          'GET',
          'POST',
          'PUT',
          'PATCH',
          'DELETE',
          'HEAD',
          'OPTIONS',
          'QUERY',
        ].includes((lastSegment || '').toUpperCase())

        // Option A: Callable Segments
        // If the path doesn't end in an HTTP method, treat this call as a path segment
        // e.g. client.users('123') -> path becomes ['users', '123']
        if (!isMethod) {
          const segmentArg = args[0] !== undefined ? String(args[0]) : ''
          return createProxy([...path, segmentArg], config, httpClient)
        }

        const method = path.pop()!.toUpperCase() as any
        let urlPath = '/' + path.join('/')

        const payload = args[0]
        const options = (args[1] || {}) as ClientRequestOptions

        // Option B: URL Parameters substitution
        // Replaces /users/:id or /users/[id] with the values from options.params
        if (options.params) {
          for (const [key, value] of Object.entries(options.params)) {
            const stringVal = encodeURIComponent(String(value))
            // Try to replace exactly
            if (urlPath.includes(`:${key}`)) {
              urlPath = urlPath.replace(
                new RegExp(`:${key}\\b`, 'g'),
                stringVal
              )
            } else if (urlPath.includes(`[${key}]`)) {
              urlPath = urlPath.replace(
                new RegExp(`\\[${key}\\]`, 'g'),
                stringVal
              )
            } else {
              // If no placeholder was found, fallback to appending it to the path
              urlPath += `/${stringVal}`
            }
          }
        }

        // Build config for FetchClient
        const requestConfig: FetchRequestConfig = {
          ...options,
          url: urlPath,
          method,
          baseURL: config.baseUrl,
        }

        if (options.query) {
          requestConfig.params = { ...options.query }
        }

        const globalHeaders =
          typeof config.headers === 'function'
            ? await config.headers()
            : config.headers

        requestConfig.headers = {
          ...globalHeaders,
          ...options.headers,
        }

        if (payload && !['GET', 'HEAD'].includes(method)) {
          requestConfig.data = payload
        }

        try {
          if (config.onRequest) {
            await config.onRequest(requestConfig)
          }

          const responseData = await httpClient.request(requestConfig)

          if (config.onResponse) {
            await config.onResponse(responseData)
          }

          return responseData
        } catch (err: any) {
          if (config.onError) {
            await config.onError(err)
          }

          // HTML Error Overlay Logic
          if (
            err.response &&
            err.response.headers &&
            err.response.headers['content-type']?.includes('text/html') &&
            typeof document !== 'undefined'
          ) {
            const html = err.response.data
            if (typeof html === 'string') {
              const iframe = document.createElement('iframe')
              iframe.style.position = 'fixed'
              iframe.style.top = '0'
              iframe.style.left = '0'
              iframe.style.width = '100vw'
              iframe.style.height = '100vh'
              iframe.style.border = 'none'
              iframe.style.zIndex = '999999999'
              document.body.appendChild(iframe)

              const doc = iframe.contentWindow?.document
              if (doc) {
                doc.open()
                doc.write(html)
                doc.close()

                // Add close button
                const closeBtn = doc.createElement('button')
                closeBtn.textContent = '×'
                closeBtn.style.position = 'fixed'
                closeBtn.style.top = '10px'
                closeBtn.style.right = '10px'
                closeBtn.style.background = 'rgba(0,0,0,0.5)'
                closeBtn.style.color = 'white'
                closeBtn.style.border = 'none'
                closeBtn.style.borderRadius = '5px'
                closeBtn.style.padding = '5px 10px'
                closeBtn.style.cursor = 'pointer'
                closeBtn.style.fontSize = '20px'
                closeBtn.style.zIndex = '999999999'
                closeBtn.onclick = () => document.body.removeChild(iframe)
                doc.body.appendChild(closeBtn)
              }
            }
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
  const httpClient = config.client || new FetchClient()
  return createProxy([], config, httpClient) as BuildProxyRouter<TRouter>
}
