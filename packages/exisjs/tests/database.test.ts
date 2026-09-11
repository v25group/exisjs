import { describe, expect, it } from '../src/testing'
import {
  DatabaseManager,
  registerDatabase,
  withTransaction,
  modernUpdateOptions,
  mongoPoolOptions,
} from '../src/database'

describe('Database Lifecycle & Manager', () => {
  it('registers and connects all databases', async () => {
    DatabaseManager.clear()
    let connectedA = false
    let connectedB = false

    registerDatabase({
      name: 'mongo',
      connect: async () => {
        connectedA = true
      },
      disconnect: async () => {},
      isHealthy: () => true,
    })

    registerDatabase({
      name: 'postgres',
      connect: async () => {
        connectedB = true
      },
      disconnect: async () => {},
      isHealthy: () => true,
    })

    await DatabaseManager.connectAll()
    expect(connectedA).toBe(true)
    expect(connectedB).toBe(true)

    const health = await DatabaseManager.checkHealth()
    expect(health.healthy).toBe(true)
    expect(health.databases.mongo.status).toBe('connected')
    expect(health.databases.postgres.status).toBe('connected')
  })

  it('handles database health check failures gracefully', async () => {
    DatabaseManager.clear()

    registerDatabase({
      name: 'db-ok',
      connect: () => {},
      disconnect: () => {},
      isHealthy: () => true,
    })

    registerDatabase({
      name: 'db-down',
      connect: () => {},
      disconnect: () => {},
      isHealthy: () => false,
    })

    const health = await DatabaseManager.checkHealth()
    expect(health.healthy).toBe(false)
    expect(health.databases['db-ok'].status).toBe('connected')
    expect(health.databases['db-down'].status).toBe('disconnected')
  })

  it('runs disconnectAll on all registered databases', async () => {
    DatabaseManager.clear()
    let disconnected = false

    registerDatabase({
      name: 'redis-cache',
      connect: () => {},
      disconnect: async () => {
        disconnected = true
      },
    })

    await DatabaseManager.disconnectAll()
    expect(disconnected).toBe(true)
  })
})

describe('Universal withTransaction Runner', () => {
  it('executes transaction with Mongoose/MongoDB session.withTransaction', async () => {
    let committed = false
    const mockSession = {
      withTransaction: async (fn: () => Promise<void>) => {
        await fn()
        committed = true
      },
      endSession: async () => {},
    }

    const mockMongoose = {
      startSession: async () => mockSession,
    }

    const result = await withTransaction(mockMongoose, async (session) => {
      expect(session).toBe(mockSession)
      return { orderId: 12345 }
    })

    expect(result.orderId).toBe(12345)
    expect(committed).toBe(true)
  })

  it('handles manual Mongoose commit & abort fallback when withTransaction is not on session', async () => {
    let started = false
    let committed = false
    let ended = false

    const mockSession = {
      startTransaction: () => {
        started = true
      },
      commitTransaction: async () => {
        committed = true
      },
      abortTransaction: async () => {},
      endSession: async () => {
        ended = true
      },
    }

    const mockConnection = {
      startSession: async () => mockSession,
    }

    const result = await withTransaction(mockConnection, async () => {
      return 'success-data'
    })

    expect(result).toBe('success-data')
    expect(started).toBe(true)
    expect(committed).toBe(true)
    expect(ended).toBe(true)
  })

  it('aborts transaction when callback throws an error in manual session', async () => {
    let aborted = false
    let ended = false

    const mockSession = {
      startTransaction: () => {},
      commitTransaction: async () => {},
      abortTransaction: async () => {
        aborted = true
      },
      endSession: async () => {
        ended = true
      },
    }

    const mockConnection = {
      startSession: async () => mockSession,
    }

    let caughtErr: any = null
    try {
      await withTransaction(mockConnection, async () => {
        throw new Error('Database write conflict')
      })
    } catch (err) {
      caughtErr = err
    }

    expect(caughtErr).toBeDefined()
    expect(caughtErr.message).toBe('Database write conflict')
    expect(aborted).toBe(true)
    expect(ended).toBe(true)
  })

  it('executes transaction with Prisma client ($transaction)', async () => {
    let prismaTxInvoked = false
    const mockPrisma = {
      $transaction: async (fn: (tx: any) => Promise<any>) => {
        prismaTxInvoked = true
        return fn({ user: { findMany: () => ['user1'] } })
      },
    }

    const result = await withTransaction(mockPrisma, async (tx) => {
      return tx.user.findMany()
    })

    expect(prismaTxInvoked).toBe(true)
    expect(result).toEqual(['user1'])
  })

  it('executes transaction with Drizzle / SQL client (transaction)', async () => {
    let drizzleTxInvoked = false
    const mockDrizzle = {
      transaction: async (fn: (tx: any) => Promise<any>) => {
        drizzleTxInvoked = true
        return fn({ schema: 'drizzle' })
      },
    }

    const result = await withTransaction(mockDrizzle, async (tx) => {
      return tx.schema
    })

    expect(drizzleTxInvoked).toBe(true)
    expect(result).toBe('drizzle')
  })
})

describe('Modern Mongoose Options & Helpers', () => {
  it('maps legacy new: true to returnDocument: "after"', () => {
    const opts = modernUpdateOptions({ upsert: true, new: true })
    expect(opts.returnDocument).toBe('after')
    expect(opts.upsert).toBe(true)
  })

  it('maps legacy new: false to returnDocument: "before"', () => {
    const opts = modernUpdateOptions({ new: false })
    expect(opts.returnDocument).toBe('before')
  })

  it('preserves existing returnDocument option', () => {
    const opts = modernUpdateOptions({ returnDocument: 'after' })
    expect(opts.returnDocument).toBe('after')
  })

  it('returns production hardened mongoPoolOptions', () => {
    const pool = mongoPoolOptions()
    expect(pool.maxPoolSize).toBe(10)
    expect(pool.minPoolSize).toBe(2)
    expect(pool.serverSelectionTimeoutMS).toBe(5000)
    expect(pool.socketTimeoutMS).toBe(45000)

    const custom = mongoPoolOptions({ maxPoolSize: 25 })
    expect(custom.maxPoolSize).toBe(25)
    expect(custom.minPoolSize).toBe(2)
  })
})
