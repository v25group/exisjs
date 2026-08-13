/**
 * Zero-config Mongoose Integration.
 *
 * Automatically connects to MongoDB using `process.env.MONGODB_URI`
 * or `process.env.DATABASE_URL` via Mongoose.
 *
 * Peer Dependencies required:
 *   npm install mongoose
 */

export function createMongooseClient(uriOrOptions?: any, options?: any) {
  let uri: string | undefined = undefined
  let opts = options

  if (typeof uriOrOptions === 'string') {
    uri = uriOrOptions
  } else if (uriOrOptions) {
    opts = uriOrOptions
  }

  if (!uri) {
    uri =
      process.env.MONGO_URI ||
      process.env.MONGODB_URI ||
      process.env.DATABASE_URL
  }

  if (!uri) {
    throw new Error(
      'process.env.MONGO_URI or DATABASE_URL is missing. Cannot initialize Mongoose.'
    )
  }

  let mongoose: any = opts?.client

  if (!mongoose) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createRequire } = require('node:module')
      const requireFromCwd = createRequire(process.cwd() + '/package.json')
      mongoose = requireFromCwd('mongoose')
    } catch {
      console.error('Failed to resolve mongoose from', process.cwd())

      throw new Error('Missing dependencies. Please run: npm install mongoose')
    }
  }

  // Connect without awaiting. Mongoose natively buffers operations until connected.
  const connectOptions = { ...opts }
  delete connectOptions.client // don't pass client to mongoose.connect

  const connectionPromise = mongoose
    .connect(uri, connectOptions)
    .catch((err: Error) => {
      console.error('Zero-config Mongoose connection error:', err.message)
    })

  // Attach promise to mongoose object so tests can await it
  mongoose.__connectionPromise = connectionPromise

  return mongoose
}

let cachedClient: any

import { activeAppInstance } from '../server/app'

export function configureMongoose(uriOrOptions?: any, options?: any) {
  if (cachedClient) {
    console.warn(
      'Mongoose client is already initialized. Call configureMongoose() before using it.'
    )
    return cachedClient
  }
  cachedClient = createMongooseClient(uriOrOptions, options)

  if (activeAppInstance) {
    activeAppInstance.onShutdown(async () => {
      if (cachedClient) {
        await cachedClient.disconnect()
      }
    })
  }

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
