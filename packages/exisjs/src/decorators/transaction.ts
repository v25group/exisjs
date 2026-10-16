import { AsyncLocalStorage } from 'node:async_hooks'

export interface TransactionalOptions {
  /** Optional named database connection */
  connection?: string
  /** Whether the transaction is read-only */
  readOnly?: boolean
}

/**
 * Automatically wraps a service method inside a database transaction.
 * Commits automatically on success, and rolls back if an unhandled exception is thrown.
 *
 * Compatible with ExisJS built-in Database client, Prisma, Drizzle, TypeORM, Knex, and raw SQL pools.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class OrderService {
 *   constructor(private db: DatabaseService) {}
 *
 *   @Transactional()
 *   async placeOrder(userId: string, items: CartItem[]) {
 *     const order = await this.db.orders.create({ userId })
 *     await this.db.inventory.decrement(items)
 *     return order
 *   }
 * }
 * ```
 */
// Instance properties that may hold the database client, in lookup order
const DB_KEYS = ['db', 'database', 'prisma', 'dataSource', 'connection']

// Services are usually shared singletons, so the transaction must not be
// written onto the instance: a concurrent request using the same service
// would run its queries inside this request's transaction. Instead the
// database property becomes a getter that returns the transaction only
// within the async context of the @Transactional call (and anything it
// awaits or calls, which therefore joins the transaction).
const activeTransactions = new AsyncLocalStorage<Map<object, any>>()
const BOUND = Symbol('exis.transactionalProperty')

function bindDbProperty(self: any, key: string): boolean {
  const own = Object.getOwnPropertyDescriptor(self, key)
  if (own?.get && (own.get as any)[BOUND]) return true
  // An inherited or hand-written accessor cannot be wrapped safely
  if (own === undefined ? key in self : own.get || own.set) return false
  if (own !== undefined && !own.configurable) return false

  let value = own?.value
  const get = function () {
    const tx = activeTransactions.getStore()?.get(self)
    return tx !== undefined ? tx : value
  }
  ;(get as any)[BOUND] = true
  Object.defineProperty(self, key, {
    configurable: true,
    enumerable: own?.enumerable ?? true,
    get,
    set(next: any) {
      value = next
    },
  })
  return true
}

function runWithTransaction<T>(
  self: any,
  key: string,
  tx: any,
  fn: (target: any) => T
): T {
  if (bindDbProperty(self, key)) {
    const store = new Map(activeTransactions.getStore())
    store.set(self, tx)
    return activeTransactions.run(store, () => fn(self))
  }
  // Fallback for accessor-defined clients: a per-call view of the instance
  const scoped = Object.create(self)
  scoped[key] = tx
  return fn(scoped)
}

export function Transactional(
  _options: TransactionalOptions = {}
): MethodDecorator {
  return function (
    _target: any,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      const self = this as any
      const key = DB_KEYS.find((k) => self[k])
      const db = key ? self[key] : (globalThis as any).__EXIS_DB__

      if (db) {
        const runInTransaction = (tx: any) =>
          runWithTransaction(self, key ?? 'db', tx, (target) =>
            originalMethod.apply(target, args)
          )

        // 1. Functional transaction wrapper: db.transaction((tx) => ...)
        if (typeof db.transaction === 'function') {
          return db.transaction(runInTransaction)
        }

        // 2. Prisma-style $transaction: db.$transaction(async (tx) => ...)
        if (typeof db.$transaction === 'function') {
          return db.$transaction(runInTransaction)
        }

        // 3. Imperative beginTransaction / commit / rollback
        if (typeof db.beginTransaction === 'function') {
          await db.beginTransaction()
          try {
            const result = await originalMethod.apply(self, args)
            if (typeof db.commit === 'function') await db.commit()
            return result
          } catch (error) {
            if (typeof db.rollback === 'function') await db.rollback()
            throw error
          }
        }
      }

      // Default pass-through if no transaction provider is attached
      return originalMethod.apply(self, args)
    }

    return descriptor
  }
}
