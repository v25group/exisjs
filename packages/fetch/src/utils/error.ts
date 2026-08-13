export const FetchErrorCodes = {
  ERR_BAD_OPTION_VALUE: 'ERR_BAD_OPTION_VALUE',
  ERR_BAD_OPTION: 'ERR_BAD_OPTION',
  ERR_NOT_SUPPORT: 'ERR_NOT_SUPPORT',
  ERR_DEPRECATED: 'ERR_DEPRECATED',
  ERR_INVALID_URL: 'ERR_INVALID_URL',
  ECONNABORTED: 'ECONNABORTED',
  ETIMEDOUT: 'ETIMEDOUT',
  ERR_CANCELED: 'ERR_CANCELED',
  ERR_NETWORK: 'ERR_NETWORK',
  ERR_BAD_REQUEST: 'ERR_BAD_REQUEST',
  ERR_BAD_RESPONSE: 'ERR_BAD_RESPONSE',
  ERR_FR_TOO_MANY_REDIRECTS: 'ERR_FR_TOO_MANY_REDIRECTS',
  ERR_MOCK_NOT_FOUND: 'ERR_MOCK_NOT_FOUND',
} as const

import type { FetchRequestConfig, FetchResponse, FetchError } from '../types'

export function makeFetchError<T = any, D = any>(params: {
  message: string
  config: FetchRequestConfig<D>
  code?: string
  request?: Request
  response?: FetchResponse<T, D>
  isTimeout?: boolean
  isNetworkError?: boolean
  isCancel?: boolean
}): FetchError<T, D> {
  const err = new Error(params.message) as FetchError<T, D>
  err.name = 'FetchError'
  err.config = params.config
  err.code = params.code
  err.request = params.request
  err.response = params.response
  err.isFetchError = true
  err.isTimeout = params.isTimeout ?? false
  err.isNetworkError = params.isNetworkError ?? false
  err.isCancel = params.isCancel ?? false

  const responseData: any = params.response?.data
  if (
    responseData &&
    typeof responseData === 'object' &&
    Array.isArray(responseData.errors)
  ) {
    const isValidationError = responseData.errors.every(
      (e: any) =>
        typeof e === 'object' &&
        e !== null &&
        typeof e.path === 'string' &&
        typeof e.message === 'string'
    )
    if (isValidationError) {
      err.validationErrors = responseData.errors
    }
  }

  err.toJSON = () => ({
    message: err.message,
    name: err.name,
    code: err.code,
    validationErrors: err.validationErrors,
    config: {
      url: params.config.url,
      method: params.config.method,
      baseURL: params.config.baseURL,
      timeout: params.config.timeout,
    },
    status: params.response?.status ?? null,
  })
  Object.setPrototypeOf(err, Error.prototype)
  return err
}
