import type { AdapterResult, FetchRequestConfig, MockRoute } from '../types'
import { buildURL, sleep, FetchErrorCodes } from '../utils/index'

/**
 * Builds an `adapter` function from a table of routes. Attach it via
 * `client.create({ adapter: createMockAdapter([...]) })` in your tests.
 */
export function createMockAdapter(
  routes: MockRoute[]
): (config: FetchRequestConfig) => Promise<AdapterResult> {
  return async (config: FetchRequestConfig): Promise<AdapterResult> => {
    const method = (config.method ?? 'get').toUpperCase()
    const url = buildURL(
      config.baseURL,
      config.url ?? '',
      config.params as Record<string, unknown>,
      config.paramsSerializer
    )

    const match = routes.find((route) => {
      const methodMatches =
        !route.method || route.method.toUpperCase() === method
      const urlMatches =
        typeof route.url === 'string' ? route.url === url : route.url.test(url)
      return methodMatches && urlMatches
    })

    if (!match) {
      throw Object.assign(
        new Error(`[mock adapter] No route matches ${method} ${url}`),
        { code: FetchErrorCodes.ERR_MOCK_NOT_FOUND }
      )
    }

    if (match.delay) await sleep(match.delay)

    const data = await match.response(config)

    return {
      data,
      status: match.status ?? 200,
      statusText: match.statusText ?? 'OK',
      headers: match.headers ?? {},
    }
  }
}
