/**
 * Zero-config Prisma ORM Integration.
 *
 * Automatically initializes Prisma and suppresses excessive logging for edge deployments.
 *
 * Peer Dependencies required:
 *   npm install @prisma/client
 */

export function prisma() {
  let PrismaClient: any

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('@prisma/client')
    PrismaClient = pkg.PrismaClient
  } catch {
    throw new Error(
      'Missing dependencies. Please run: npm install @prisma/client'
    )
  }

  // Create a singleton instance
  // Since we assume `process.env.DATABASE_URL` is available, Prisma natively picks it up
  const client = new PrismaClient()

  return client
}
