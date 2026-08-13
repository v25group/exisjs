import type { FetchError, LoggerOptions } from '../types'
import type { FetchClient } from '../lib/index'

/**
 * Registers request/response/error logging interceptors on a client.
 *
 *   const http = new FetchClient();
 *   attachLogger(http);
 */
export function attachLogger(
  client: FetchClient,
  options: LoggerOptions = {}
): void {
  const {
    logRequests = true,
    logResponses = true,
    logErrors = true,
    logger = console,
  } = options

  const startTimes = new WeakMap<any, number>()

  if (logRequests) {
    client.interceptors.request.use((config) => {
      startTimes.set(config, Date.now())
      logger.log(
        `→ ${(config.method ?? 'get').toUpperCase()} ${config.url ?? ''}`
      )
      return config
    })
  }

  if (logResponses) {
    client.interceptors.response.use((response) => {
      const start = startTimes.get(response.config)
      const ms = start !== undefined ? Date.now() - start : undefined
      const suffix = response.cached
        ? ' (cache)'
        : ms !== undefined
          ? ` (${ms}ms)`
          : ''
      logger.log(`← ${response.status} ${response.config.url ?? ''}${suffix}`)
      return response
    })
  }

  if (logErrors) {
    client.interceptors.response.use(undefined, (error) => {
      const fetchErr = error as FetchError
      logger.error(`✕ ${fetchErr?.config?.url ?? 'request failed'}`, fetchErr)
      throw error
    })
  }
}
