export * from './mocks'
export * from './client'

import { before, after } from 'node:test'
import { createTestApp, TestApp } from './client'

// Re-export native test runner features for developer convenience
export {
  test,
  describe,
  it,
  before,
  after,
  beforeEach,
  afterEach,
  mock,
} from 'node:test'
export { default as assert } from 'node:assert'

export function createTestContext(app: any): TestApp {
  process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION DETECTED:', reason)
  })

  before(async () => {
    if (typeof app.create === 'function') {
      await app.create()
    }
    if (typeof app.onStartHook === 'function') {
      await app.onStartHook(app)
    }

    // Wait for Mongoose to finish connecting to prevent node:test race conditions
    // where tests finish faster than the DB connection, causing node:test to cancel them.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createRequire } = require('node:module')
      const requireFromCwd = createRequire(process.cwd() + '/package.json')
      const mongoose = requireFromCwd('mongoose')
      console.log('mongoose.__connectionPromise exists:', !!mongoose.__connectionPromise)
      if (mongoose.__connectionPromise) {
        await mongoose.__connectionPromise
      } else if (mongoose.connection && mongoose.connection.readyState === 2) {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        await mongoose.connection.asPromise().catch(() => {})
      }
    } catch {
      // noop
    }

    // Flush the microtask queue so that background promises (like mongoose.connect)
    // fully resolve before the test suite starts.
    await new Promise((r) => setTimeout(r, 50))
  })

  after(async () => {
    // Attempt graceful shutdown of database connections to let event loop exit
    console.log('Testing: executing after hook')

    // Mongoose
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createRequire } = require('node:module')
      const requireFromCwd = createRequire(process.cwd() + '/package.json')
      const mongoose = requireFromCwd('mongoose')
      if (mongoose.connection && mongoose.connection.readyState !== 0) {
        if (mongoose.connection.readyState === 2) { // 2 = connecting
          console.log('Testing: awaiting mongoose connection')
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          await mongoose.connection.asPromise().catch(() => {})
        }
        console.log('Testing: disconnecting mongoose')
        await mongoose.disconnect()
        console.log('Testing: disconnected mongoose')
      }
    } catch {
      // mongoose not installed or used
    }

    // Prisma
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-require-imports
      const { PrismaClient } = require('@prisma/client')
      // Currently, we don't have a direct reference to the user's Prisma instance,
      // but developers typically export it or handle it. For Exis zero-config,
      // we might need to rely on the user for now unless we cache it similarly.
    } catch {
      // Prisma not used
    }

    // Redis
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { redis } = require('../integrations/redis') as any
      if (redis && typeof redis.quit === 'function') {
        console.log('Testing: disconnecting redis')
        await redis.quit()
      }
    } catch {
      // Redis not used
    }

    // Call the built-in graceful shutdown which cleans up the queue, 
    // cron jobs, database connections, and running servers.
    if (typeof app.close === 'function') {
      console.log('Testing: app.close()')
      await app.close()
      console.log('Testing: app.close() finished')
    }
  })

  return createTestApp(app)
}
