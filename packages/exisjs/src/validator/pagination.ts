import type { PaginatedResult } from './types'

/**
 * Wraps an array of data with structured pagination metadata.
 *
 * @param data Array of records for the current page
 * @param total Total count of records across all pages
 * @param options Object containing `page` and `limit`
 * @returns Standardized `PaginatedResult<T>` with metadata (`page`, `limit`, `totalPages`, `hasNextPage`, `hasPrevPage`)
 *
 * @example
 * ```ts
 * const { users, count } = await UserRepository.findAndCount({ skip: 0, take: 10 })
 * return paginate(users, count, { page: 1, limit: 10 })
 * ```
 */
export function paginate<T>(
  data: T[],
  total: number,
  options: { page?: number; limit?: number } = {}
): PaginatedResult<T> {
  const page = Math.max(1, Number(options.page) || 1)
  const limit = Math.max(1, Number(options.limit) || 20)
  const totalPages = Math.ceil(total / limit)
  const hasNext = page < totalPages
  const hasPrev = page > 1

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: hasNext,
      hasPrevPage: hasPrev,
      hasNext,
      hasPrev,
    },
  }
}

/**
 * Computes database offset (`skip`) and `limit` from request query parameters.
 *
 * @param query Query object with `page` and `limit`
 * @returns Calculated `{ skip, limit, page }` for database queries (e.g. Prisma, TypeORM, Drizzle, Kysely)
 *
 * @example
 * ```ts
 * const { skip, limit } = getPaginationSkip(query)
 * const users = await prisma.user.findMany({ skip, take: limit })
 * ```
 */
export function getPaginationSkip(
  query: { page?: number; limit?: number } = {}
): {
  skip: number
  limit: number
  page: number
} {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.max(1, Number(query.limit) || 20)
  return {
    skip: (page - 1) * limit,
    limit,
    page,
  }
}
