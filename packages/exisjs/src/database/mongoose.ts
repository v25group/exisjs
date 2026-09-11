/**
 * Options for findOneAndUpdate / findByIdAndUpdate in modern Mongoose (8 & 9).
 */
export interface ModernUpdateOptions {
  upsert?: boolean
  returnDocument?: 'before' | 'after'
  /** Legacy option mapped to returnDocument: 'after' */
  new?: boolean
  lean?: boolean
  runValidators?: boolean
  session?: any
  select?: any
  populate?: any
  sort?: any
  [key: string]: any
}

/**
 * Normalizes findOneAndUpdate / findByIdAndUpdate options for modern Mongoose.
 * Automatically maps legacy `{ new: true }` to `{ returnDocument: 'after' }`
 * to prevent deprecation warnings in Mongoose 9 while preserving backward compatibility.
 *
 * Example:
 * ```ts
 * const user = await User.findOneAndUpdate(
 *   { email },
 *   { $set: { lastLogin: new Date() } },
 *   modernUpdateOptions({ upsert: true, new: true })
 * )
 * ```
 */
export function modernUpdateOptions<T extends ModernUpdateOptions>(
  options: T = {} as T
): T & { returnDocument?: 'before' | 'after' } {
  const normalized: any = { ...options }

  if (normalized.new === true && !normalized.returnDocument) {
    normalized.returnDocument = 'after'
  } else if (normalized.new === false && !normalized.returnDocument) {
    normalized.returnDocument = 'before'
  }

  return normalized
}

export interface MongoPoolConfig {
  maxPoolSize?: number
  minPoolSize?: number
  serverSelectionTimeoutMS?: number
  socketTimeoutMS?: number
  heartbeatFrequencyMS?: number
  autoIndex?: boolean
}

/**
 * Generates recommended, production-hardened connection pool options
 * for MongoDB / Mongoose in cloud environments (Atlas, AWS, GCP, Azure).
 */
export function mongoPoolOptions(
  overrides: MongoPoolConfig = {}
): MongoPoolConfig {
  return {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    heartbeatFrequencyMS: 10000,
    autoIndex: process.env.NODE_ENV !== 'production',
    ...overrides,
  }
}
