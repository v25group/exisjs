/**
 * Zero-config MongoDB Integration.
 *
 * Automatically initializes the MongoDB client using `process.env.MONGODB_URI`
 * or `process.env.DATABASE_URL`.
 *
 * Peer Dependencies required:
 *   npm install mongodb
 */

export function createMongoClient(options?: any) {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL
  if (!uri) {
    throw new Error(
      'process.env.MONGODB_URI or DATABASE_URL is missing. Cannot initialize MongoDB.'
    )
  }

  let MongoClient: any

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    MongoClient = require('mongodb').MongoClient
  } catch {
    throw new Error('Missing dependencies. Please run: npm install mongodb')
  }

  return new MongoClient(uri, options)
}

let cachedClient: any

export function configureMongo(options: any) {
  if (cachedClient) {
    console.warn(
      'MongoDB client is already initialized. Call configureMongo() before using it.'
    )
    return cachedClient
  }
  cachedClient = createMongoClient(options)
  return cachedClient
}

export const mongo = new Proxy(
  {},
  {
    get(target, prop) {
      if (!cachedClient) {
        cachedClient = createMongoClient()
      }
      const value = cachedClient[prop]
      return typeof value === 'function' ? value.bind(cachedClient) : value
    },
  }
)
