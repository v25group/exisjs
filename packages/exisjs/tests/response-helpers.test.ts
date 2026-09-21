import { describe, it, expect } from '../src/testing'
import {
  success,
  created,
  accepted,
  noContent,
  error,
  problem,
  paginate,
  getPaginationSkip,
  json,
  redirect,
  HttpStatus,
  getStatusText,
  isSuccessStatus,
  isRedirectStatus,
  isClientError,
  isServerError,
  ExisResponse,
  SSEStream,
  formatSSEEvent,
} from '../src/response/index'

describe('exisjs/response: Standard Envelopes & Helpers', () => {
  it('builds success() response envelope', () => {
    const res1 = success({ id: 1, name: 'Alice' })
    expect(res1.success).toBe(true)
    expect(res1.data).toEqual({ id: 1, name: 'Alice' })
    expect(res1.message).toBeUndefined()
    expect(res1.meta).toBeUndefined()

    const res2 = success([1, 2, 3], 'List loaded', { cached: true })
    expect(res2.success).toBe(true)
    expect(res2.data).toEqual([1, 2, 3])
    expect(res2.message).toBe('List loaded')
    expect(res2.meta).toEqual({ cached: true })
  })

  it('builds created() response envelope', () => {
    const res = created({ id: 101 }, 'Resource created', { traceId: 'abc' })
    expect(res.success).toBe(true)
    expect(res.data).toEqual({ id: 101 })
    expect(res.message).toBe('Resource created')
    expect(res.meta).toEqual({ traceId: 'abc' })
  })

  it('builds accepted() response envelope', () => {
    const res = accepted({ taskId: '99' })
    expect(res.success).toBe(true)
    expect(res.data).toEqual({ taskId: '99' })
    expect(res.message).toBe('Accepted')

    const resEmpty = accepted()
    expect(resEmpty.success).toBe(true)
    expect(resEmpty.data).toBeNull()
  })

  it('builds noContent() envelope', () => {
    const res = noContent()
    expect(res.success).toBe(true)
    expect(res.data).toBeNull()
  })

  it('builds error() response envelope', () => {
    const res1 = error('Something went wrong')
    expect(res1.success).toBe(false)
    expect(res1.error.message).toBe('Something went wrong')
    expect(res1.error.code).toBeUndefined()
    expect(res1.error.details).toBeUndefined()
    expect(res1.error.status).toBeUndefined()

    const res2 = error(
      'Invalid credentials',
      'AUTH_UNAUTHORIZED',
      { attemptsLeft: 2 },
      401
    )
    expect(res2.success).toBe(false)
    expect(res2.error.message).toBe('Invalid credentials')
    expect(res2.error.code).toBe('AUTH_UNAUTHORIZED')
    expect(res2.error.details).toEqual({ attemptsLeft: 2 })
    expect(res2.error.status).toBe(401)
  })

  it('builds problem() RFC 7807 problem details object', () => {
    const pd = problem('Validation Error', 422, 'The field email is required', {
      type: 'https://example.com/probs/validation',
      instance: '/api/v1/users',
      invalidParams: [{ name: 'email', reason: 'Missing email' }],
    })

    expect(pd.title).toBe('Validation Error')
    expect(pd.status).toBe(422)
    expect(pd.detail).toBe('The field email is required')
    expect(pd.type).toBe('https://example.com/probs/validation')
    expect(pd.instance).toBe('/api/v1/users')
    expect(pd.invalidParams).toHaveLength(1)
  })

  it('builds paginate() response envelope with accurate metadata', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    const res = paginate(items, 45, { page: 2, limit: 10 }, 'Page 2 results', {
      filtered: true,
    })

    expect(res.success).toBe(true)
    expect(res.data).toEqual(items)
    expect(res.message).toBe('Page 2 results')
    expect(res.meta).toEqual({ filtered: true })
    expect(res.pagination.page).toBe(2)
    expect(res.pagination.limit).toBe(10)
    expect(res.pagination.total).toBe(45)
    expect(res.pagination.totalPages).toBe(5)
    expect(res.pagination.hasNextPage).toBe(true)
    expect(res.pagination.hasPrevPage).toBe(true)
    expect(res.pagination.hasNext).toBe(true)
    expect(res.pagination.hasPrev).toBe(true)
  })

  it('calculates pagination boundary conditions properly in paginate()', () => {
    const firstPage = paginate([1], 10, { page: 1, limit: 10 })
    expect(firstPage.pagination.hasPrevPage).toBe(false)
    expect(firstPage.pagination.hasNextPage).toBe(false)

    const lastPage = paginate([1], 25, { page: 3, limit: 10 })
    expect(lastPage.pagination.hasPrevPage).toBe(true)
    expect(lastPage.pagination.hasNextPage).toBe(false)
  })

  it('calculates getPaginationSkip() properly', () => {
    expect(getPaginationSkip()).toEqual({ skip: 0, limit: 20, page: 1 })
    expect(getPaginationSkip({ page: 3, limit: 15 })).toEqual({
      skip: 30,
      limit: 15,
      page: 3,
    })
    expect(getPaginationSkip({ page: -5, limit: -10 })).toEqual({
      skip: 0,
      limit: 1,
      page: 1,
    })
  })

  it('constructs json() and redirect() helper descriptors', () => {
    const j = json({ hello: 'world' }, 201, { 'X-Custom': 'Value' })
    expect(j.data).toEqual({ hello: 'world' })
    expect(j.status).toBe(201)
    expect(j.headers['X-Custom']).toBe('Value')

    const r = redirect('/login', 307)
    expect(r.redirect).toBe('/login')
    expect(r.status).toBe(307)
  })

  it('provides HttpStatus constants, getStatusText and status predicates', () => {
    expect(HttpStatus.OK).toBe(200)
    expect(HttpStatus.CREATED).toBe(201)
    expect(HttpStatus.NOT_FOUND).toBe(404)
    expect(HttpStatus.INTERNAL_SERVER_ERROR).toBe(500)

    expect(getStatusText(200)).toBe('OK')
    expect(getStatusText(404)).toBe('Not Found')
    expect(getStatusText(500)).toBe('Internal Server Error')

    expect(isSuccessStatus(200)).toBe(true)
    expect(isSuccessStatus(204)).toBe(true)
    expect(isSuccessStatus(400)).toBe(false)

    expect(isRedirectStatus(301)).toBe(true)
    expect(isRedirectStatus(302)).toBe(true)
    expect(isRedirectStatus(200)).toBe(false)

    expect(isClientError(400)).toBe(true)
    expect(isClientError(404)).toBe(true)
    expect(isClientError(500)).toBe(false)

    expect(isServerError(500)).toBe(true)
    expect(isServerError(503)).toBe(true)
    expect(isServerError(404)).toBe(false)
  })

  it('re-exports ExisResponse and SSE stream utilities', () => {
    expect(typeof ExisResponse).toBe('function')
    expect(typeof SSEStream).toBe('function')
    expect(typeof formatSSEEvent).toBe('function')

    const formatted = formatSSEEvent({ event: 'ping', data: { time: 123 } })
    expect(formatted).toContain('event: ping')
    expect(formatted).toContain('data: {"time":123}')
  })
})
