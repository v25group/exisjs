/**
 * Zero-config Resend Integration.
 *
 * Automatically initializes the Resend client using `process.env.RESEND_API_KEY`.
 *
 * Peer Dependencies required:
 *   npm install resend
 */

export function createResendClient(options?: any) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error(
      'process.env.RESEND_API_KEY is missing. Cannot initialize Resend.'
    )
  }

  let ResendClient: any

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ResendClient = require('resend').Resend
  } catch {
    throw new Error('Missing dependencies. Please run: npm install resend')
  }

  return new ResendClient(apiKey, options)
}

let cachedClient: any

export function configureResend(options: any) {
  if (cachedClient) {
    console.warn(
      'Resend client is already initialized. Call configureResend() before using it.'
    )
    return cachedClient
  }
  cachedClient = createResendClient(options)
  return cachedClient
}

export const resend = new Proxy(
  {},
  {
    get(target, prop) {
      if (!cachedClient) {
        cachedClient = createResendClient()
      }
      const value = cachedClient[prop]
      return typeof value === 'function' ? value.bind(cachedClient) : value
    },
  }
)
