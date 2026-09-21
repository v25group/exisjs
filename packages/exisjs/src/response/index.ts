// ─── Standard Response Envelope Types ─────────────────────────────────────────

/**
 * Standard successful response envelope.
 */
export type SuccessResponse<T = unknown, M = Record<string, unknown>> = {
  success: true
  data: T
  message?: string
  meta?: M
}

/**
 * Standard error response envelope.
 */
export type ErrorResponse<E = unknown> = {
  success: false
  error: {
    message: string
    code?: string
    status?: number
    details?: E
    [key: string]: unknown
  }
}

/**
 * Discriminated union of standard API response types.
 */
export type ApiResponse<T = unknown, E = unknown, M = Record<string, unknown>> =
  SuccessResponse<T, M> | ErrorResponse<E>

/**
 * Pagination metadata included in paginated responses.
 */
export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
  hasNext: boolean
  hasPrev: boolean
}

/**
 * Standard paginated response envelope.
 */
export interface PaginatedResponse<T = unknown, M = Record<string, unknown>> {
  success: true
  data: T[]
  pagination: PaginationMeta
  message?: string
  meta?: M
}

/**
 * RFC 7807 / RFC 9457 Problem Details object specification for HTTP APIs.
 */
export interface ProblemDetails {
  type?: string
  title: string
  status: number
  detail?: string
  instance?: string
  invalidParams?: { name: string; reason: string }[]
  [key: string]: unknown
}

/**
 * HTTP response headers map.
 */
export type ResponseHeaders = Record<
  string,
  string | number | readonly string[]
>

// ─── HTTP Status Codes ────────────────────────────────────────────────────────

/**
 * Standard HTTP Status Code Constants.
 */
export const HttpStatus = {
  // 2xx Success
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NON_AUTHORITATIVE_INFORMATION: 203,
  NO_CONTENT: 204,
  RESET_CONTENT: 205,
  PARTIAL_CONTENT: 206,

  // 3xx Redirection
  MULTIPLE_CHOICES: 300,
  MOVED_PERMANENTLY: 301,
  FOUND: 302,
  SEE_OTHER: 303,
  NOT_MODIFIED: 304,
  TEMPORARY_REDIRECT: 307,
  PERMANENT_REDIRECT: 308,

  // 4xx Client Errors
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  PROXY_AUTHENTICATION_REQUIRED: 407,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  GONE: 410,
  LENGTH_REQUIRED: 411,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  URI_TOO_LONG: 414,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RANGE_NOT_SATISFIABLE: 416,
  EXPECTATION_FAILED: 417,
  IM_A_TEAPOT: 418,
  MISDIRECTED_REQUEST: 421,
  UNPROCESSABLE_ENTITY: 422,
  LOCKED: 423,
  FAILED_DEPENDENCY: 424,
  TOO_EARLY: 425,
  UPGRADE_REQUIRED: 426,
  PRECONDITION_REQUIRED: 428,
  TOO_MANY_REQUESTS: 429,
  REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
  UNAVAILABLE_FOR_LEGAL_REASONS: 451,

  // 5xx Server Errors
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  HTTP_VERSION_NOT_SUPPORTED: 505,
  VARIANT_ALSO_NEGOTIATES: 506,
  INSUFFICIENT_STORAGE: 507,
  LOOP_DETECTED: 508,
  NOT_EXTENDED: 510,
  NETWORK_AUTHENTICATION_REQUIRED: 511,
} as const

export type HttpStatusCode = (typeof HttpStatus)[keyof typeof HttpStatus]

const STATUS_TEXT_MAP: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
}

/**
 * Returns human-readable status text for a given HTTP status code.
 */
export function getStatusText(status: number): string {
  return (
    STATUS_TEXT_MAP[status] ||
    (status >= 200 && status < 300 ? 'OK' : 'Unknown Status')
  )
}

/**
 * Determines whether a status code represents a 2xx success.
 */
export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300
}

/**
 * Determines whether a status code represents a 3xx redirection.
 */
export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400
}

/**
 * Determines whether a status code represents a 4xx client error.
 */
export function isClientError(status: number): boolean {
  return status >= 400 && status < 500
}

/**
 * Determines whether a status code represents a 5xx server error.
 */
export function isServerError(status: number): boolean {
  return status >= 500 && status < 600
}

// ─── Response Builders ────────────────────────────────────────────────────────

/**
 * Creates a standard 200 OK success response envelope.
 *
 * @example
 * return success(user, 'User profile retrieved successfully')
 */
export function success<T, M = Record<string, unknown>>(
  data: T,
  message?: string,
  meta?: M
): SuccessResponse<T, M> {
  const res: SuccessResponse<T, M> = { success: true, data }
  if (message !== undefined) res.message = message
  if (meta !== undefined) res.meta = meta
  return res
}

/**
 * Creates a standard 201 Created response envelope.
 *
 * @example
 * return created(newUser, 'User created successfully')
 */
export function created<T, M = Record<string, unknown>>(
  data: T,
  message = 'Created',
  meta?: M
): SuccessResponse<T, M> {
  const res: SuccessResponse<T, M> = { success: true, data, message }
  if (meta !== undefined) res.meta = meta
  return res
}

/**
 * Creates a standard 202 Accepted response envelope for async background processing.
 *
 * @example
 * return accepted({ jobId: '123' }, 'Job queued for background execution')
 */
export function accepted<T = null, M = Record<string, unknown>>(
  data: T = null as unknown as T,
  message = 'Accepted',
  meta?: M
): SuccessResponse<T, M> {
  const res: SuccessResponse<T, M> = { success: true, data, message }
  if (meta !== undefined) res.meta = meta
  return res
}

/**
 * Creates a standard 204 No Content response representation.
 *
 * @example
 * return noContent()
 */
export function noContent(): { success: true; data: null } {
  return { success: true, data: null }
}

/**
 * Creates a standard error response envelope.
 *
 * @example
 * return error('Invalid credentials', 'AUTH_INVALID_CREDENTIALS', undefined, 401)
 */
export function error<E = unknown>(
  message: string,
  code?: string,
  details?: E,
  status?: number
): ErrorResponse<E> {
  const res: ErrorResponse<E> = { success: false, error: { message } }
  if (code !== undefined) res.error.code = code
  if (details !== undefined) res.error.details = details
  if (status !== undefined) res.error.status = status
  return res
}

/**
 * Creates a standardized RFC 7807 / RFC 9457 Problem Details object.
 *
 * @example
 * return problem('Invalid Request Body', 422, 'The email field is invalid', {
 *   invalidParams: [{ name: 'email', reason: 'Must be a valid email format' }]
 * })
 */
export function problem(
  title: string,
  status: number,
  detail?: string,
  options: Partial<ProblemDetails> = {}
): ProblemDetails {
  return {
    title,
    status,
    ...(detail ? { detail } : {}),
    ...options,
  }
}

/**
 * Creates a standardized paginated response envelope.
 *
 * @example
 * return paginate(users, totalCount, { page: 1, limit: 20 })
 */
export function paginate<T, M = Record<string, unknown>>(
  data: T[],
  total: number,
  options: { page?: number; limit?: number } = {},
  message?: string,
  meta?: M
): PaginatedResponse<T, M> {
  const page = Math.max(1, Number(options.page) || 1)
  const limit = Math.max(1, Number(options.limit) || 20)
  const totalPages = Math.ceil(total / limit)
  const hasNext = page < totalPages
  const hasPrev = page > 1

  const res: PaginatedResponse<T, M> = {
    success: true,
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

  if (message !== undefined) res.message = message
  if (meta !== undefined) res.meta = meta

  return res
}

/**
 * Calculates SQL/Database `skip` (offset) and `limit` from pagination query parameters.
 *
 * @example
 * const { skip, limit, page } = getPaginationSkip(req.query)
 * const users = await db.user.findMany({ skip, take: limit })
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

/**
 * Helper to build custom JSON payload structure with optional status code and headers hint.
 */
export function json<T>(
  data: T,
  status = 200,
  headers: ResponseHeaders = {}
): { data: T; status: number; headers: ResponseHeaders } {
  return { data, status, headers }
}

/**
 * Helper to create a redirection descriptor.
 */
export function redirect(
  url: string,
  status = 302
): { redirect: string; status: number } {
  return { redirect: url, status }
}

// ─── Direct Re-exports ────────────────────────────────────────────────────────

export { ExisResponse } from '../server/response'
export {
  SSEStream,
  formatSSEEvent,
  type SSEOptions,
  type SSEMessage,
} from '../server/sse'
export type { CookieOptions } from '../types'
