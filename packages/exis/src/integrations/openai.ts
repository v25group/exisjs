/**
 * Zero-config OpenAI Integration.
 *
 * Automatically initializes the OpenAI client using `process.env.OPENAI_API_KEY`.
 *
 * Peer Dependencies required:
 *   npm install openai
 */

export function createOpenAIClient(options: any = {}) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey && !options.apiKey) {
    throw new Error(
      'process.env.OPENAI_API_KEY is missing. Cannot initialize OpenAI.'
    )
  }

  let OpenAI: any

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    OpenAI = require('openai').OpenAI || require('openai').default
  } catch {
    throw new Error('Missing dependencies. Please run: npm install openai')
  }

  return new OpenAI({ apiKey, ...options })
}

let cachedClient: any

export function configureOpenAI(options: any) {
  if (cachedClient) {
    console.warn(
      'OpenAI client is already initialized. Call configureOpenAI() before using it.'
    )
    return cachedClient
  }
  cachedClient = createOpenAIClient(options)
  return cachedClient
}

export const openai = new Proxy(
  {},
  {
    get(target, prop) {
      if (!cachedClient) {
        cachedClient = createOpenAIClient()
      }
      const value = cachedClient[prop]
      return typeof value === 'function' ? value.bind(cachedClient) : value
    },
  }
)
