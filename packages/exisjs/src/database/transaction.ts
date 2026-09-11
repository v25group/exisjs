export interface TransactionOptions {
  maxRetries?: number
  timeoutMs?: number
  readPreference?: string
  readConcern?: string | { level: string }
  writeConcern?: { w: number | string; j?: boolean; wtimeout?: number }
}

/**
 * Universal transaction runner for ExisJS.
 *
 * Automatically detects whether client is Mongoose, MongoDB, Prisma, or Drizzle/SQL,
 * runs the operation within an ACID transaction, commits on success, and rolls back on error.
 *
 * Example with Mongoose:
 * ```ts
 * const result = await withTransaction(mongoose, async (session) => {
 *   const order = await Order.create([{ userId, total }], { session })
 *   await Inventory.updateOne({ _id: itemId }, { $inc: { stock: -1 } }, { session })
 *   return order[0]
 * })
 * ```
 *
 * Example with Prisma:
 * ```ts
 * const result = await withTransaction(prisma, async (tx) => {
 *   const user = await tx.user.create({ data: { email } })
 *   await tx.profile.create({ data: { userId: user.id } })
 *   return user
 * })
 * ```
 */
export async function withTransaction<T>(
  clientOrConnection: any,
  callback: (sessionOrTx: any) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  if (!clientOrConnection) {
    throw new Error(
      '[ExisJS Transaction] A valid database client or connection is required'
    )
  }

  // 1. Prisma Client Interop (client.$transaction)
  if (typeof clientOrConnection.$transaction === 'function') {
    return clientOrConnection.$transaction(async (tx: any) => {
      return callback(tx)
    }, options)
  }

  // 2. Drizzle / Knex / Generic SQL Interop (client.transaction)
  if (typeof clientOrConnection.transaction === 'function') {
    return clientOrConnection.transaction(async (tx: any) => {
      return callback(tx)
    })
  }

  // 3. Mongoose / MongoDB Driver Interop (startSession)
  const getSessionFn =
    clientOrConnection.startSession ||
    clientOrConnection.connection?.startSession ||
    clientOrConnection.client?.startSession

  if (typeof getSessionFn === 'function') {
    const sessionTarget = clientOrConnection.startSession
      ? clientOrConnection
      : clientOrConnection.connection?.startSession
        ? clientOrConnection.connection
        : clientOrConnection.client

    const session = await sessionTarget.startSession(options)

    // Use built-in session.withTransaction if available (handles automatic retries for transient errors)
    if (typeof session.withTransaction === 'function') {
      try {
        let result: T
        await session.withTransaction(async () => {
          result = await callback(session)
        }, options)
        return result!
      } finally {
        await session.endSession()
      }
    }

    // Manual startTransaction / commit / abort fallback
    try {
      session.startTransaction()
      const result = await callback(session)
      await session.commitTransaction()
      return result
    } catch (err) {
      try {
        await session.abortTransaction()
      } catch {
        /* ignore abort error and bubble original */
      }
      throw err
    } finally {
      try {
        await session.endSession()
      } catch {
        /* ignore endSession cleanup error */
      }
    }
  }

  // 4. If callback was passed directly or connection is already a session
  if (typeof clientOrConnection.commitTransaction === 'function') {
    return callback(clientOrConnection)
  }

  throw new Error(
    '[ExisJS Transaction] Provided database client does not support transactions (missing startSession, $transaction, or transaction method)'
  )
}
