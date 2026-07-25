/**
 * Zero-config Supabase Integration.
 *
 * Automatically initializes the Supabase client using `process.env.SUPABASE_URL`
 * and `process.env.SUPABASE_ANON_KEY` or `process.env.SUPABASE_SERVICE_ROLE_KEY`.
 *
 * Peer Dependencies required:
 *   npm install @supabase/supabase-js
 */

export function createSupabaseClient(options: any = {}) {
  const url = process.env.SUPABASE_URL || options.url
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    options.key

  if (!url || !key) {
    throw new Error(
      'process.env.SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) are missing. Cannot initialize Supabase.'
    )
  }

  let createClient: any

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    createClient = require('@supabase/supabase-js').createClient
  } catch {
    throw new Error(
      'Missing dependencies. Please run: npm install @supabase/supabase-js'
    )
  }

  return createClient(url, key, options)
}

let cachedClient: any

export function configureSupabase(options: any) {
  if (cachedClient) {
    console.warn(
      'Supabase client is already initialized. Call configureSupabase() before using it.'
    )
    return cachedClient
  }
  cachedClient = createSupabaseClient(options)
  return cachedClient
}

export const supabase = new Proxy(
  {},
  {
    get(target, prop) {
      if (!cachedClient) {
        cachedClient = createSupabaseClient()
      }
      const value = cachedClient[prop]
      return typeof value === 'function' ? value.bind(cachedClient) : value
    },
  }
)
