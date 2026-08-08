/**
 * Zero-config Redis Integration.
 *
 * Automatically initializes Redis using `process.env.REDIS_URL` or `process.env.KV_URL`.
 *
 * Peer Dependencies required:
 *   npm install ioredis
 */

export function createRedisClient(options?: any) {
  const url = process.env.REDIS_URL || process.env.KV_URL
  if (!url) {
    throw new Error(
      'process.env.REDIS_URL or KV_URL is missing. Cannot initialize Redis.'
    )
  }

  let Redis: any

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Redis = require('ioredis').Redis || require('ioredis')
  } catch {
    throw new Error('Missing dependencies. Please run: npm install ioredis')
  }

  return new Redis(url, options)
}

// Export a singleton instance getter to delay initialization until accessed
let cachedClient: any

export function configureRedis(options: any) {
  if (cachedClient) {
    console.warn(
      'Redis client is already initialized. Call configureRedis() before using it.'
    )
    return cachedClient
  }
  cachedClient = createRedisClient(options)
  return cachedClient
}

export const redis = new Proxy(
  {},
  {
    get(target, prop) {
      if (!cachedClient) {
        cachedClient = createRedisClient()
      }
      const value = cachedClient[prop]
      return typeof value === 'function' ? value.bind(cachedClient) : value
    },
  }
)
