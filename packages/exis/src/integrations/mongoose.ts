/**
 * Zero-config Mongoose Integration.
 *
 * Automatically connects to MongoDB using `process.env.MONGODB_URI`
 * or `process.env.DATABASE_URL` via Mongoose.
 *
 * Peer Dependencies required:
 *   npm install mongoose
 */

export function createMongooseClient(options?: any) {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL
  if (!uri) {
    throw new Error(
      'process.env.MONGODB_URI or DATABASE_URL is missing. Cannot initialize Mongoose.'
    )
  }

  let mongoose: any

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createRequire } = require('node:module')
    const requireFromCwd = createRequire(process.cwd() + '/package.json')
    mongoose = requireFromCwd('mongoose')
  } catch {
    console.error('Failed to resolve mongoose from', process.cwd())
    // eslint-disable-next-line preserve-caught-error
    throw new Error('Missing dependencies. Please run: npm install mongoose')
  }

  // Connect without awaiting. Mongoose natively buffers operations until connected.
  const connectionPromise = mongoose.connect(uri, options).catch((err: Error) => {
    console.error('Zero-config Mongoose connection error:', err.message)
  })
  
  // Attach promise to mongoose object so tests can await it
  mongoose.__connectionPromise = connectionPromise

  return mongoose
}

let cachedClient: any

export function configureMongoose(options: any) {
  if (cachedClient) {
    console.warn(
      'Mongoose client is already initialized. Call configureMongoose() before using it.'
    )
    return cachedClient
  }
  cachedClient = createMongooseClient(options)
  return cachedClient
}

export const mongoose = new Proxy(
  {},
  {
    get(target, prop) {
      if (!cachedClient) {
        cachedClient = createMongooseClient()
      }
      const value = cachedClient[prop]
      return typeof value === 'function' ? value.bind(cachedClient) : value
    },
  }
)
