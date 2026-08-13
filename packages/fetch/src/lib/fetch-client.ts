import type {
  FetchRequestConfig,
  FetchResponse,
  FetchError,
  InterceptorHandler,
  InterceptorManager,
} from '../types'
import { isCancel, type Cancel } from '../cancel'
import {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_RETRY_ON,
  DEFAULT_VALIDATE_STATUS,
  FetchErrorCodes,
  MemoryCache,
  applyTransformRequest,
  applyTransformResponse,
  buildURL,
  getRequestKey,
  headersToRecord,
  makeFetchError,
  mergeHeaders,
  parseBodyWithProgress,
  readCookie,
  shouldAttachXSRF,
  sleep,
  toFormData,
} from '../utils/index'
import { InterceptorManagerImpl } from './interceptor'

export class FetchClient {
  public defaults: FetchRequestConfig

  public interceptors: {
    request: InterceptorManager<FetchRequestConfig>
    response: InterceptorManager<FetchResponse>
  }

  /** In-memory response cache. Call `client.cache.clear()` to reset it. */
  public cache = new MemoryCache()

  /** In-flight requests keyed by method+URL+body, used for de-duplication. */
  private pending = new Map<string, Promise<FetchResponse<any, any>>>()

  constructor(config: FetchRequestConfig = {}) {
    this.defaults = {
      method: 'get',
      timeout: 0,
      responseType: 'json',
      validateStatus: DEFAULT_VALIDATE_STATUS,
      retries: 0,
      retryDelay: 300,
      retryOn: DEFAULT_RETRY_ON,
      xsrfCookieName: 'XSRF-TOKEN',
      xsrfHeaderName: 'X-XSRF-TOKEN',
      transitional: {
        silentJSONParsing: true,
        forcedJSONParsing: true,
        clarifyTimeoutError: false,
      },
      ...config,
      headers: mergeHeaders(
        {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
        },
        config.headers
      ),
    }

    this.interceptors = {
      request: new InterceptorManagerImpl<FetchRequestConfig>(),
      response: new InterceptorManagerImpl<FetchResponse>(),
    }
  }

  // ── request() — public entry point, handles cache + de-dupe ──────────────

  public request<T = any, D = any>(
    configOrUrl: string | FetchRequestConfig<D>,
    config?: FetchRequestConfig<D>
  ): Promise<FetchResponse<T, D>> {
    let merged: FetchRequestConfig<D>
    if (typeof configOrUrl === 'string') {
      merged = {
        ...this.defaults,
        url: configOrUrl,
        ...(config ?? {}),
      } as FetchRequestConfig<D>
    } else {
      merged = { ...this.defaults, ...configOrUrl } as FetchRequestConfig<D>
    }
    merged.headers = mergeHeaders(
      this.defaults.headers as Record<string, string>,
      merged.headers as Record<string, string> | undefined
    )

    const method = (merged.method ?? 'get').toUpperCase()
    const cacheable =
      !!merged.cache &&
      (method === 'GET' || method === 'HEAD' || method === 'QUERY')
    const dedupeEnabled = !!merged.dedupe
    const needsKey = cacheable || dedupeEnabled
    const key = needsKey ? getRequestKey(merged, true) : undefined

    if (cacheable && key) {
      const cached = this.cache.get(key)
      if (cached) {
        return Promise.resolve({ ...cached, cached: true } as FetchResponse<
          T,
          D
        >)
      }
    }

    if (dedupeEnabled && key) {
      const inflight = this.pending.get(key)
      if (inflight) return inflight as Promise<FetchResponse<T, D>>
    }

    const execution = this._performRequest<T, D>(merged).then((response) => {
      if (cacheable && key) {
        const ttl =
          typeof merged.cache === 'object' && merged.cache
            ? (merged.cache.ttl ?? DEFAULT_CACHE_TTL_MS)
            : DEFAULT_CACHE_TTL_MS
        this.cache.set(key, response, ttl)
      }
      return response
    })

    if (dedupeEnabled && key) {
      this.pending.set(key, execution)
      execution.finally(() => this.pending.delete(key))
    }

    return execution
  }

  // ── Interceptor pipeline + network execution ──────────────────────────────

  private async _performRequest<T, D>(
    merged: FetchRequestConfig<D>
  ): Promise<FetchResponse<T, D>> {
    // ── Request interceptors — LIFO (last added runs first) ─────────────────
    const reqHandlers: InterceptorHandler<FetchRequestConfig>[] = []
    ;(
      this.interceptors.request as InterceptorManagerImpl<FetchRequestConfig>
    ).forEach((h) => {
      if (!h.options?.runWhen || h.options.runWhen(merged)) {
        reqHandlers.unshift(h) // reverse order = LIFO
      }
    })

    let resolvedConfig: FetchRequestConfig<D> = merged
    for (const h of reqHandlers) {
      try {
        if (h.fulfilled) {
          resolvedConfig = (await h.fulfilled(
            resolvedConfig as FetchRequestConfig
          )) as FetchRequestConfig<D>
        }
      } catch (e) {
        if (h.rejected)
          resolvedConfig = (await h.rejected(e)) as FetchRequestConfig<D>
        else throw e
      }
    }

    // ── Execute HTTP ──────────────────────────────────────────────────────
    let response = await this._execute<T, D>(resolvedConfig)

    // ── Response interceptors — FIFO (first added runs first) ───────────────
    const resHandlers: InterceptorHandler<FetchResponse>[] = []
    ;(
      this.interceptors.response as InterceptorManagerImpl<FetchResponse>
    ).forEach((h) => resHandlers.push(h))

    for (const h of resHandlers) {
      try {
        if (h.fulfilled) {
          response = (await h.fulfilled(
            response as FetchResponse
          )) as FetchResponse<T, D>
        }
      } catch (e) {
        if (h.rejected) response = (await h.rejected(e)) as FetchResponse<T, D>
        else throw e
      }
    }

    return response
  }

  // ── Internal HTTP / adapter execution ─────────────────────────────────────

  private async _execute<T, D>(
    cfg: FetchRequestConfig<D>
  ): Promise<FetchResponse<T, D>> {
    if (!cfg.url) {
      throw makeFetchError({
        message: '[fetch] No URL provided.',
        config: cfg,
        code: FetchErrorCodes.ERR_INVALID_URL,
      })
    }

    const method = (cfg.method ?? 'get').toUpperCase()
    const url = buildURL(
      cfg.baseURL,
      cfg.url,
      cfg.params as Record<string, unknown>,
      cfg.paramsSerializer
    )
    const timeout = cfg.timeout ?? 0
    const clarifyTimeout = cfg.transitional?.clarifyTimeoutError ?? false
    const retries = cfg.retries ?? 0
    const retryDelay = cfg.retryDelay ?? 300
    const retryOn = cfg.retryOn ?? DEFAULT_RETRY_ON
    const validateStatus = cfg.validateStatus ?? DEFAULT_VALIDATE_STATUS
    const fetchFn = cfg.env?.fetch ?? globalThis.fetch?.bind(globalThis)

    let attempt = 0

    while (true) {
      // ── Timeout + cancellation signals ──────────────────────────────────
      const timeoutController = new AbortController()
      const allSignals: AbortSignal[] = [timeoutController.signal]
      if (cfg.signal) allSignals.push(cfg.signal)
      if (cfg.cancelToken) allSignals.push(cfg.cancelToken.signal)

      let timeoutId: ReturnType<typeof setTimeout> | undefined
      if (timeout > 0) {
        timeoutId = setTimeout(
          () => timeoutController.abort('timeout'),
          timeout
        )
      }

      const combinedSignal: AbortSignal =
        typeof AbortSignal !== 'undefined' && 'any' in AbortSignal
          ? (AbortSignal as { any(s: AbortSignal[]): AbortSignal }).any(
              allSignals
            )
          : allSignals[0]

      let rawRequest: Request | undefined

      try {
        let response: FetchResponse<T, D>

        // ── Mock adapter path — bypass the network entirely ────────────────
        if (cfg.adapter) {
          const result = await cfg.adapter(cfg as FetchRequestConfig<D>)
          let data: unknown = result.data
          if (cfg.transformResponse) {
            data = applyTransformResponse(data, cfg.transformResponse)
          }
          response = {
            data: data as T,
            status: result.status ?? 200,
            statusText: result.statusText ?? 'OK',
            headers: result.headers ?? {},
            config: cfg,
          }
        } else {
          // ── Headers ────────────────────────────────────────────────────
          const headers: Record<string, string> = {
            ...(cfg.headers as Record<string, string>),
          }

          // HTTP Basic auth
          if (cfg.auth) {
            const creds = btoa(`${cfg.auth.username}:${cfg.auth.password}`)
            headers['Authorization'] = `Basic ${creds}`
          }

          // XSRF protection (browser only)
          if (shouldAttachXSRF(cfg, url)) {
            const token = readCookie(cfg.xsrfCookieName ?? 'XSRF-TOKEN')
            if (token) headers[cfg.xsrfHeaderName ?? 'X-XSRF-TOKEN'] = token
          }

          // ── Body ───────────────────────────────────────────────────────
          let body: BodyInit | undefined
          let rawBody: unknown = cfg.data ?? cfg.body

          if (cfg.transformRequest) {
            rawBody = applyTransformRequest(
              rawBody,
              headers,
              cfg.transformRequest
            )
          }

          if (
            rawBody !== undefined &&
            rawBody !== null &&
            !['GET', 'HEAD'].includes(method)
          ) {
            const ct = (
              headers['Content-Type'] ??
              headers['content-type'] ??
              ''
            ).toLowerCase()

            if (
              typeof rawBody === 'string' ||
              rawBody instanceof URLSearchParams ||
              rawBody instanceof Blob ||
              rawBody instanceof ArrayBuffer ||
              rawBody instanceof FormData
            ) {
              body = rawBody as BodyInit
              if (rawBody instanceof FormData) {
                delete headers['Content-Type']
                delete headers['content-type']
              }
            } else if (ct.includes('application/x-www-form-urlencoded')) {
              const usp = new URLSearchParams()
              Object.entries(rawBody as Record<string, unknown>).forEach(
                ([k, v]) => {
                  if (v !== null && v !== undefined) usp.append(k, String(v))
                }
              )
              body = usp.toString()
            } else if (ct.includes('multipart/form-data')) {
              const FD = cfg.env?.FormData ?? FormData
              body = toFormData(rawBody as Record<string, unknown>, {
                FormDataClass: FD,
                ...(cfg.formSerializer ?? {}),
              }) as unknown as BodyInit
              delete headers['Content-Type']
              delete headers['content-type']
            } else {
              body = JSON.stringify(rawBody)
              if (!headers['Content-Type'] && !headers['content-type']) {
                headers['Content-Type'] = 'application/json'
              }
            }
          }

          // ── Fetch ──────────────────────────────────────────────────────
          rawRequest = new Request(url, {
            method,
            headers,
            body,
            signal: combinedSignal,
            credentials: cfg.withCredentials ? 'include' : 'same-origin',
            ...(cfg.fetchOptions ?? {}),
          })

          const rawResponse = await fetchFn(rawRequest)

          let data = await parseBodyWithProgress(
            rawResponse,
            cfg.responseType,
            cfg.transitional,
            cfg.onDownloadProgress
          )

          if (cfg.transformResponse) {
            data = applyTransformResponse(data, cfg.transformResponse)
          }

          response = {
            data: data as T,
            status: rawResponse.status,
            statusText: rawResponse.statusText,
            headers: headersToRecord(rawResponse.headers),
            config: cfg,
            request: rawRequest,
          }
        }

        // ── Validate status (shared by both the fetch and adapter paths) ──
        if (validateStatus && !validateStatus(response.status)) {
          const shouldRetry =
            attempt < retries && retryOn.includes(response.status)

          if (shouldRetry) {
            attempt++
            await sleep(retryDelay * Math.pow(2, attempt - 1))
            continue
          }

          throw makeFetchError<T, D>({
            message: `Request failed with status code ${response.status}`,
            config: cfg,
            code:
              response.status >= 500
                ? FetchErrorCodes.ERR_BAD_RESPONSE
                : FetchErrorCodes.ERR_BAD_REQUEST,
            request: rawRequest,
            response,
          })
        }

        return response
      } catch (err: unknown) {
        if ((err as FetchError).isFetchError) throw err

        // CancelToken cancellation
        if (isCancel(err)) {
          throw makeFetchError({
            message: (err as Cancel).message ?? 'Request cancelled',
            config: cfg,
            code: FetchErrorCodes.ERR_CANCELED,
            isCancel: true,
          })
        }

        const isAbortError =
          err instanceof DOMException && err.name === 'AbortError'
        const isTimedOut = isAbortError && timeout > 0

        // Retry on transient network failures
        if (!isTimedOut && attempt < retries) {
          attempt++
          await sleep(retryDelay * Math.pow(2, attempt - 1))
          continue
        }

        const timeoutCode = clarifyTimeout
          ? FetchErrorCodes.ETIMEDOUT
          : FetchErrorCodes.ECONNABORTED

        throw makeFetchError<T, D>({
          message: isTimedOut
            ? (cfg.timeoutErrorMessage ?? `timeout of ${timeout}ms exceeded`)
            : `Network Error: ${(err as Error).message ?? 'unknown'}`,
          config: cfg,
          code: isTimedOut ? timeoutCode : FetchErrorCodes.ERR_NETWORK,
          isTimeout: isTimedOut,
          isNetworkError: !isTimedOut,
        })
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
      }
    }
  }

  // ── Convenience methods ───────────────────────────────────────────────────

  public get<T = any, D = any>(
    url: string,
    config?: FetchRequestConfig<D>
  ): Promise<FetchResponse<T, D>> {
    return this.request<T, D>({ ...config, method: 'get', url })
  }

  public post<T = any, D = any>(
    url: string,
    data?: D,
    config?: FetchRequestConfig<D>
  ): Promise<FetchResponse<T, D>> {
    return this.request<T, D>({ ...config, method: 'post', url, data })
  }

  public put<T = any, D = any>(
    url: string,
    data?: D,
    config?: FetchRequestConfig<D>
  ): Promise<FetchResponse<T, D>> {
    return this.request<T, D>({ ...config, method: 'put', url, data })
  }

  public patch<T = any, D = any>(
    url: string,
    data?: D,
    config?: FetchRequestConfig<D>
  ): Promise<FetchResponse<T, D>> {
    return this.request<T, D>({ ...config, method: 'patch', url, data })
  }

  public delete<T = any, D = any>(
    url: string,
    config?: FetchRequestConfig<D>
  ): Promise<FetchResponse<T, D>> {
    return this.request<T, D>({ ...config, method: 'delete', url })
  }

  public head<T = any, D = any>(
    url: string,
    config?: FetchRequestConfig<D>
  ): Promise<FetchResponse<T, D>> {
    return this.request<T, D>({ ...config, method: 'head', url })
  }

  public options<T = any, D = any>(
    url: string,
    config?: FetchRequestConfig<D>
  ): Promise<FetchResponse<T, D>> {
    return this.request<T, D>({ ...config, method: 'options', url })
  }

  public query<T = any, D = any>(
    url: string,
    data?: D,
    config?: FetchRequestConfig<D>
  ): Promise<FetchResponse<T, D>> {
    return this.request<T, D>({ ...config, method: 'query', url, data })
  }

  // FormData shortcut methods

  public postForm<T = any>(
    url: string,
    data?: Record<string, unknown>,
    config?: FetchRequestConfig
  ): Promise<FetchResponse<T>> {
    return this.post<T>(url, data as never, {
      ...config,
      headers: mergeHeaders(
        { 'Content-Type': 'multipart/form-data' },
        config?.headers
      ),
    })
  }

  public putForm<T = any>(
    url: string,
    data?: Record<string, unknown>,
    config?: FetchRequestConfig
  ): Promise<FetchResponse<T>> {
    return this.put<T>(url, data as never, {
      ...config,
      headers: mergeHeaders(
        { 'Content-Type': 'multipart/form-data' },
        config?.headers
      ),
    })
  }

  public patchForm<T = any>(
    url: string,
    data?: Record<string, unknown>,
    config?: FetchRequestConfig
  ): Promise<FetchResponse<T>> {
    return this.patch<T>(url, data as never, {
      ...config,
      headers: mergeHeaders(
        { 'Content-Type': 'multipart/form-data' },
        config?.headers
      ),
    })
  }

  /** Build a URL without making a request. */
  public getUri(config?: FetchRequestConfig): string {
    return buildURL(
      config?.baseURL ?? this.defaults.baseURL,
      config?.url ?? '',
      config?.params as Record<string, unknown>,
      config?.paramsSerializer
    )
  }

  /** Create a scoped client that inherits this client's defaults. */
  public create(config: FetchRequestConfig = {}): FetchClient {
    return new FetchClient({
      ...this.defaults,
      ...config,
      headers: mergeHeaders(
        this.defaults.headers as Record<string, string>,
        config.headers as Record<string, string> | undefined
      ),
    })
  }
}
