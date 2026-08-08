/**
 * Zero-config PostgreSQL Integration.
 *
 * Automatically initializes a PostgreSQL connection pool using `process.env.POSTGRES_URL`
 * or `process.env.DATABASE_URL`.
 *
 * Peer Dependencies required:
 *   npm install postgres
 */

export function createPostgresClient(options?: any) {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'process.env.POSTGRES_URL or DATABASE_URL is missing. Cannot initialize PostgreSQL.'
    )
  }

  let postgres: any

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    postgres = require('postgres')
  } catch {
    throw new Error('Missing dependencies. Please run: npm install postgres')
  }

  return postgres(url, options)
}

let cachedClient: any

export function configurePostgres(options: any) {
  if (cachedClient) {
    console.warn(
      'PostgreSQL client is already initialized. Call configurePostgres() before using it.'
    )
    return cachedClient
  }
  cachedClient = createPostgresClient(options)
  return cachedClient
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export const sql = new Proxy(() => {}, {
  apply(target, thisArg, argArray) {
    if (!cachedClient) {
      cachedClient = createPostgresClient()
    }
    return cachedClient(...argArray)
  },
  get(target, prop) {
    if (!cachedClient) {
      cachedClient = createPostgresClient()
    }
    const value = cachedClient[prop]
    return typeof value === 'function' ? value.bind(cachedClient) : value
  },
})
