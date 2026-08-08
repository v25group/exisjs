/**
 * Zero-config Drizzle ORM Integration.
 *
 * Automatically initializes Drizzle using `process.env.DATABASE_URL`.
 *
 * Peer Dependencies required:
 *   npm install drizzle-orm postgres
 */

export function drizzle<TSchema extends Record<string, unknown>>(
  schema: TSchema
) {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'process.env.DATABASE_URL is missing. Cannot initialize Drizzle.'
    )
  }

  // Dynamic require to avoid bloating the core framework bundle if Drizzle isn't used.
  let postgres: any
  let drizzleOrm: any

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    postgres = require('postgres')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    drizzleOrm = require('drizzle-orm/postgres-js')
  } catch {
    throw new Error(
      'Missing dependencies. Please run: npm install drizzle-orm postgres'
    )
  }

  // Initialize the connection pool
  const sql = postgres(url, { max: 10 })

  // Return the drizzle client
  return drizzleOrm.drizzle(sql, { schema })
}
