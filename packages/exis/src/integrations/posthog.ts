/**
 * Zero-config PostHog Integration.
 *
 * Automatically initializes the PostHog client using `process.env.POSTHOG_API_KEY`
 * and optionally `process.env.POSTHOG_HOST`.
 *
 * Peer Dependencies required:
 *   npm install posthog-node
 */

export function createPosthogClient(options: any = {}) {
  const apiKey = process.env.POSTHOG_API_KEY || options.apiKey
  const host =
    process.env.POSTHOG_HOST || options.host || 'https://app.posthog.com'

  if (!apiKey) {
    throw new Error(
      'process.env.POSTHOG_API_KEY is missing. Cannot initialize PostHog.'
    )
  }

  let PostHog: any

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    PostHog = require('posthog-node').PostHog
  } catch {
    throw new Error(
      'Missing dependencies. Please run: npm install posthog-node'
    )
  }

  return new PostHog(apiKey, { host, ...options })
}

let cachedClient: any

export function configurePosthog(options: any) {
  if (cachedClient) {
    console.warn(
      'PostHog client is already initialized. Call configurePosthog() before using it.'
    )
    return cachedClient
  }
  cachedClient = createPosthogClient(options)
  return cachedClient
}

export const posthog = new Proxy(
  {},
  {
    get(target, prop) {
      if (!cachedClient) {
        cachedClient = createPosthogClient()
      }
      const value = cachedClient[prop]
      return typeof value === 'function' ? value.bind(cachedClient) : value
    },
  }
)
