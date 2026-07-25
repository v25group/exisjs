export type SuccessResponse<T> = {
  success: true
  message?: string
  data: T
}

export type ErrorResponse = {
  success: false
  error: {
    message: string
    code?: string
    details?: unknown
  }
}

export function success<T>(data: T, message?: string): SuccessResponse<T> {
  const res: SuccessResponse<T> = { success: true, data }
  if (message !== undefined) res.message = message
  return res
}

export function error(
  message: string,
  code?: string,
  details?: unknown
): ErrorResponse {
  const res: ErrorResponse = { success: false, error: { message } }
  if (code !== undefined) res.error.code = code
  if (details !== undefined) res.error.details = details
  return res
}
