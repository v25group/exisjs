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
      const db =
        self.db ||
        self.database ||
        self.prisma ||
        self.dataSource ||
        self.connection ||
        (globalThis as any).__EXIS_DB__

      if (db) {
        // 1. Functional transaction wrapper: db.transaction((tx) => ...)
        if (typeof db.transaction === 'function') {
          return db.transaction(async (tx: any) => {
            const originalDb = self.db
            try {
              self.db = tx
              return await originalMethod.apply(self, args)
            } finally {
              self.db = originalDb
            }
          })
        }

        // 2. Prisma-style $transaction: db.$transaction(async (tx) => ...)
        if (typeof db.$transaction === 'function') {
          return db.$transaction(async (tx: any) => {
            const originalPrisma = self.prisma || self.db
            try {
              if (self.prisma) self.prisma = tx
              if (self.db) self.db = tx
              return await originalMethod.apply(self, args)
            } finally {
              if (self.prisma) self.prisma = originalPrisma
              if (self.db) self.db = originalPrisma
            }
          })
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
