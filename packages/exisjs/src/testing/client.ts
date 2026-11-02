import http from 'node:http'
import path from 'node:path'
import { App } from '../server/app'
import type { ExisAppDefinition } from '../server/define'
import { describeAccess } from '../router/authorize'
import {
  auditRouteTable,
  loadRouteAudit,
  routeAuditKey,
  type RouteAuditResult,
} from '../router/route-audit'

export interface TestResponse {
  status: number
  headers: http.IncomingHttpHeaders

  body: any
  text: string
}

// One boot per definition, shared with createTestContext
async function resolveApp(source: App | ExisAppDefinition): Promise<App> {
  const definition = source as any
  if (
    definition._isExisAppDefinition ||
    definition.__isAppDefinition ||
    typeof definition.boot === 'function'
  ) {
    if (!definition._bootPromise) definition._bootPromise = definition.boot()
    return definition._bootPromise
  }
  return source as App
}

interface StoredCookie {
  value: string
  path: string
  expires?: number
}

class CookieJar {
  private cookies = new Map<string, StoredCookie>()

  store(setCookie: string | string[] | undefined): void {
    if (!setCookie) return
    // inject() joins repeated headers with commas. A comma also appears inside
    // Expires dates, so split only where the next cookie's name= begins
    const lines = Array.isArray(setCookie)
      ? setCookie
      : setCookie.split(/,(?=\s*[^;,=\s]+=)/)
    for (const line of lines) {
      const [pair, ...attributes] = line.split(';')
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      const name = pair.slice(0, eq).trim()
      const cookie: StoredCookie = { value: pair.slice(eq + 1), path: '/' }

      for (const attribute of attributes) {
        const [key, val = ''] = attribute.split('=')
        const lower = key.trim().toLowerCase()
        if (lower === 'path') cookie.path = val.trim()
        else if (lower === 'max-age') {
          cookie.expires = Date.now() + Number(val) * 1000
        } else if (lower === 'expires' && cookie.expires === undefined) {
          cookie.expires = Date.parse(val)
        }
      }

      if (cookie.expires !== undefined && cookie.expires <= Date.now()) {
        this.cookies.delete(name)
      } else {
        this.cookies.set(name, cookie)
      }
    }
  }

  get(name: string): string | undefined {
    const cookie = this.cookies.get(name)
    if (!cookie) return undefined
    if (cookie.expires !== undefined && cookie.expires <= Date.now()) {
      this.cookies.delete(name)
      return undefined
    }
    return cookie.value
  }

  header(url: string): string {
    const pathname = url.split('?')[0]
    const pairs: string[] = []
    for (const [name, cookie] of this.cookies) {
      const inPath =
        cookie.path === '/' ||
        pathname === cookie.path ||
        pathname.startsWith(cookie.path.replace(/\/$/, '') + '/')
      const value = inPath ? this.get(name) : undefined
      if (value !== undefined) pairs.push(`${name}=${value}`)
    }
    return pairs.join('; ')
  }

  clear(): void {
    this.cookies.clear()
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE'])

export interface TestBrowserOptions {
  /** The cookie `csrf()` sets. Default: `csrf-token` */
  csrfCookie?: string
  /** The header `csrf()` reads. Default: `x-csrf-token` */
  csrfHeader?: string
  /** A route to GET first when a state-changing request has no token yet */
  csrfPath?: string
}

/** What a request needs from `browser()`: cookies and the CSRF token */
interface BrowserSession {
  prepare(request: TestRequest): Promise<void>
  receive(response: TestResponse): void
}

export class TestRequest {
  private _appSource: App | ExisAppDefinition
  private _session?: BrowserSession
  private _appPromise?: Promise<App>
  private _app?: App
  private _method: string
  private _path: string
  private _body?: unknown
  private _headers: Record<string, string> = {}
  private _expectedStatus?: number
  private _expectedHeaders: Record<string, string | RegExp> = {}
  private _expectedBody?: unknown
  private _timeoutMs = Number(process.env.EXIS_TEST_TIMEOUT) || 5000

  constructor(
    app: App | ExisAppDefinition,
    method: string,
    path: string,
    session?: BrowserSession
  ) {
    this._appSource = app
    this._method = method
    this._path = path
    this._session = session
  }

  get method(): string {
    return this._method
  }

  get path(): string {
    return this._path
  }

  /** A header set on this request so far (lowercase name) */
  header(name: string): string | undefined {
    return this._headers[name]
  }

  send(body: unknown): this {
    this._body = body
    return this
  }

  /** Adds query-string parameters: `.query({ page: 2, tags: ['a', 'b'] })` */
  query(
    params: Record<string, string | number | boolean | (string | number)[]>
  ): this {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      for (const v of Array.isArray(value) ? value : [value]) {
        search.append(key, String(v))
      }
    }
    const qs = search.toString()
    if (qs) this._path += (this._path.includes('?') ? '&' : '?') + qs
    return this
  }

  /**
   * Fails the request after `ms` (default 5000, or `EXIS_TEST_TIMEOUT`),
   * so a handler that never answers fails its test instead of hanging the run.
   * `0` waits forever.
   */
  timeout(ms: number): this {
    this._timeoutMs = ms
    return this
  }

  set(header: string, value: string): this {
    this._headers[header.toLowerCase()] = value
    return this
  }

  expect(status: number): this
  expect(header: string, value: string | RegExp): this
  expect(body: unknown): this
  expect(arg1: unknown, arg2?: unknown): this {
    if (typeof arg1 === 'number') {
      this._expectedStatus = arg1
    } else if (typeof arg1 === 'string' && arg2 !== undefined) {
      this._expectedHeaders[arg1.toLowerCase()] = arg2 as string | RegExp
    } else {
      this._expectedBody = arg1
    }
    return this
  }

  then<TResult1 = TestResponse, TResult2 = never>(
    onfulfilled?:
      | ((value: TestResponse) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }

  catch<TResult = never>(
    onrejected?:
      ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined | null
  ): Promise<TestResponse | TResult> {
    return this.execute().catch(onrejected)
  }

  finally(onfinally?: (() => void) | undefined | null): Promise<TestResponse> {
    return this.execute().finally(onfinally)
  }

  public async execute(): Promise<TestResponse> {
    if (!this._app) this._app = await resolveApp(this._appSource)

    if (this._session) await this._session.prepare(this)

    const payload = this._body

    try {
      const res = await this._app!.inject({
        method: this._method,
        url: this._path,
        headers: this._headers,
        body: payload,
        timeoutMs: this._timeoutMs,
      })

      if (this._session) this._session.receive(res)
      this.assertResponse(res)
      return res
    } catch (err: any) {
      const error = new Error(`Injection failed: ${err.message}`)
      ;(error as any).cause = err
      throw error
    }
  }

  private assertResponse(res: TestResponse) {
    if (this._expectedStatus !== undefined) {
      if (res.status !== this._expectedStatus) {
        throw new Error(
          `Expected status ${this._expectedStatus}, got ${res.status}. Body: ${res.text}`
        )
      }
    }

    for (const [key, expectedVal] of Object.entries(this._expectedHeaders)) {
      const actualVal = res.headers[key]
      if (expectedVal instanceof RegExp) {
        if (!actualVal || !expectedVal.test(String(actualVal))) {
          throw new Error(
            `Expected header ${key} to match ${expectedVal}, got ${actualVal}`
          )
        }
      } else {
        if (actualVal !== expectedVal) {
          throw new Error(
            `Expected header ${key} to be ${expectedVal}, got ${actualVal}`
          )
        }
      }
    }

    if (this._expectedBody !== undefined) {
      if (
        typeof this._expectedBody === 'object' &&
        this._expectedBody !== null &&
        typeof res.body === 'object' &&
        res.body !== null
      ) {
        // Semantic object comparison that is key-order independent
        const isDeepEqual = (a: any, b: any): boolean => {
          if (a === b) return true
          if (
            typeof a !== 'object' ||
            a === null ||
            typeof b !== 'object' ||
            b === null
          )
            return false
          const keysA = Object.keys(a)
          const keysB = Object.keys(b)
          if (keysA.length !== keysB.length) return false
          for (const key of keysA) {
            if (!keysB.includes(key) || !isDeepEqual(a[key], b[key]))
              return false
          }
          return true
        }
        if (!isDeepEqual(this._expectedBody, res.body)) {
          throw new Error(
            `Expected body ${JSON.stringify(this._expectedBody)}, got ${JSON.stringify(res.body)}`
          )
        }
      } else {
        const expectedStr = JSON.stringify(this._expectedBody)
        const actualStr = JSON.stringify(res.body)
        if (expectedStr !== actualStr) {
          throw new Error(`Expected body ${expectedStr}, got ${actualStr}`)
        }
      }
    }
  }
}

export interface RequestOptions {
  headers?: Record<string, string>
  body?: unknown
  payload?: unknown
}

/** A route as `getRoutes()` reports it */
export interface TestRoute {
  method: string
  path: string
  /** `public`, `roles: a|b`, `perms: x+y`, or `-` when the route declares none */
  access: string
  /** Relative to the working directory; `null` for a route registered in code */
  sourceFile: string | null
}

export interface RouteAuditOptions {
  /** Routes reviewed as open. Default: the list in `routes-audit.json` */
  open?: string[]
  /** Stands in for `:param` and `*wildcard` in each URL */
  param?: string
}

export interface FullRouteAuditResult extends RouteAuditResult {
  /** Closed routes that answered an anonymous caller with something else */
  unprotected: { route: string; status: number }[]
}

interface TestClient {
  get(path: string, options?: RequestOptions): TestRequest
  post(path: string, options?: RequestOptions | unknown): TestRequest
  put(path: string, options?: RequestOptions | unknown): TestRequest
  patch(path: string, options?: RequestOptions | unknown): TestRequest
  delete(path: string, options?: RequestOptions): TestRequest
  options(path: string, options?: RequestOptions): TestRequest
  head(path: string, options?: RequestOptions): TestRequest
  query(path: string, options?: RequestOptions): TestRequest
  trace(path: string, options?: RequestOptions): TestRequest
  connect(path: string, options?: RequestOptions): TestRequest
  request(method: string, path: string, options?: RequestOptions): TestRequest
}

/** A client that behaves like one browser tab: see `TestApp.browser()` */
export interface TestBrowser extends TestClient {
  /** A cookie's current value, or `undefined` */
  cookie(name: string): string | undefined
  clearCookies(): void
}

export interface TestApp extends TestClient {
  /**
   * A client with its own cookie jar, which also sends the `csrf()` token on
   * state-changing requests. Each call is a separate browser, so two of them
   * act as two users.
   */
  browser(options?: TestBrowserOptions): TestBrowser
  /** The routing table; see `getRoutes()` */
  routes(): Promise<TestRoute[]>
}

function applyRequestOptions(
  req: TestRequest,
  options?: RequestOptions | unknown
): TestRequest {
  if (!options) return req
  if (
    typeof options === 'object' &&
    options !== null &&
    ('headers' in options || 'body' in options || 'payload' in options)
  ) {
    const opt = options as RequestOptions
    if (opt.headers) {
      for (const [k, v] of Object.entries(opt.headers)) {
        req.set(k, String(v))
      }
    }
    if (opt.body !== undefined) {
      req.send(opt.body)
    } else if (opt.payload !== undefined) {
      req.send(opt.payload)
    }
  } else {
    req.send(options)
  }
  return req
}

export function createTestApp(app: App | ExisAppDefinition | any): TestApp {
  let finalApp = app
  if (
    app &&
    typeof app === 'object' &&
    !(app instanceof App) &&
    !(app as any).isApp &&
    !(app as any)._isExisAppDefinition &&
    !(app as any).__isAppDefinition &&
    typeof (app as any).inject !== 'function' &&
    typeof (app as any).boot !== 'function'
  ) {
    finalApp = new App(app)
  }

  return {
    ...createClient(finalApp),
    browser: (options) => createBrowser(finalApp, options),
    routes: () => getRoutes(finalApp),
  }
}

function createClient(
  app: App | ExisAppDefinition,
  session?: BrowserSession
): TestClient {
  const make =
    (method: string) => (path: string, opts?: RequestOptions | unknown) =>
      applyRequestOptions(new TestRequest(app, method, path, session), opts)

  return {
    get: make('GET'),
    post: make('POST'),
    put: make('PUT'),
    patch: make('PATCH'),
    delete: make('DELETE'),
    options: make('OPTIONS'),
    head: make('HEAD'),
    query: make('QUERY'),
    trace: make('TRACE'),
    connect: make('CONNECT'),
    request: (method, path, opts) => make(method)(path, opts),
  }
}

function createBrowser(
  app: App | ExisAppDefinition,
  options: TestBrowserOptions = {}
): TestBrowser {
  const jar = new CookieJar()
  const csrfCookie = options.csrfCookie ?? 'csrf-token'
  const csrfHeader = (options.csrfHeader ?? 'x-csrf-token').toLowerCase()

  const session: BrowserSession = {
    async prepare(request) {
      if (!SAFE_METHODS.has(request.method)) {
        if (jar.get(csrfCookie) === undefined && options.csrfPath) {
          await new TestRequest(app, 'GET', options.csrfPath, session).execute()
        }
        // The cookie is `token.signature`; csrf() compares the token alone
        const token = jar.get(csrfCookie)?.split('.')[0]
        if (token && request.header(csrfHeader) === undefined) {
          request.set(csrfHeader, token)
        }
      }
      const cookies = jar.header(request.path)
      if (cookies && request.header('cookie') === undefined) {
        request.set('cookie', cookies)
      }
    },
    receive(response) {
      jar.store(response.headers['set-cookie'])
    },
  }

  return {
    ...createClient(app, session),
    cookie: (name) => jar.get(name),
    clearCookies: () => jar.clear(),
  }
}

/**
 * The app's routing table, for tests that check every route.
 *
 * @example
 * ```ts
 * const routes = await getRoutes(app)
 * expect(routes.filter((r) => r.access === 'public')).toHaveLength(2)
 * ```
 */
export async function getRoutes(
  source: App | ExisAppDefinition
): Promise<TestRoute[]> {
  const app = await resolveApp(source)
  await app.routeScanner.loadAllRoutes()
  return app
    .getRoutes()
    .filter((r) => !r.sourceFile?.startsWith('lazy:'))
    .map((r) => ({
      method: r.method,
      path: r.path,
      access: describeAccess((r.schema as any)?.access),
      sourceFile: r.sourceFile
        ? path.relative(process.cwd(), r.sourceFile).replace(/\\/g, '/')
        : null,
    }))
}

/**
 * Proves the app denies by default: every open route is on a reviewed list,
 * and every other route refuses an anonymous caller with 401 or 403 (a missing
 * CSRF token answers 403). It really calls those routes, so run it against a
 * test database: a route that turns out to be unprotected runs its handler.
 *
 * @example
 * ```ts
 * const audit = await auditRoutes(app)
 * expect(audit).toEqual({ unreviewed: [], stale: [], unprotected: [] })
 * ```
 */
export async function auditRoutes(
  source: App | ExisAppDefinition,
  options: RouteAuditOptions = {}
): Promise<FullRouteAuditResult> {
  const routes = await getRoutes(source)
  const open = options.open ?? loadRouteAudit()
  const reviewed = new Set(open)
  const param = options.param ?? '000000000000000000000000'
  const app = await resolveApp(source)

  const unprotected: FullRouteAuditResult['unprotected'] = []
  for (const route of routes) {
    const key = routeAuditKey(route)
    if (
      reviewed.has(key) ||
      route.access === 'public' ||
      route.access === '-'
    ) {
      continue
    }
    const url = route.path
      .split('/')
      .map((s) => (s[0] === ':' || s[0] === '*' ? param : s))
      .join('/')
    const { status } = await app.inject({
      method: route.method === 'ALL' ? 'GET' : route.method,
      url,
    })
    if (status !== 401 && status !== 403) {
      unprotected.push({ route: key, status })
    }
  }

  return { ...auditRouteTable(routes, open), unprotected }
}

export interface TestServer {
  /** Base URL, e.g. `http://127.0.0.1:53211` */
  url: string
  port: number
  /** `fetch` against the running server: `server.request('/health')` */
  request(path: string, init?: RequestInit): Promise<Response>
  /** Runs graceful shutdown (onClose hooks, database disconnects) */
  close(): Promise<void>
}

/**
 * Starts the app on a free port on 127.0.0.1 and talks to it over real
 * sockets. Use it for what in-memory requests cannot show: CORS and
 * security headers as a browser sees them, keep-alive, malformed HTTP.
 * Set `NODE_ENV=production` before calling it to test production behaviour.
 *
 * @example
 * ```ts
 * const server = await startTestServer(app)
 * const res = await server.request('/health')
 * await server.close()
 * ```
 */
export async function startTestServer(
  source: App | ExisAppDefinition
): Promise<TestServer> {
  let app: App
  if (
    (source as any)._isExisAppDefinition ||
    typeof (source as any).boot === 'function'
  ) {
    const definition = source as any
    if (!definition._bootPromise) definition._bootPromise = definition.boot()
    app = await definition._bootPromise
  } else {
    app = source as App
    if (!(app as any)._routesMounted && typeof app.create === 'function') {
      await app.create()
    }
  }

  const port = await new Promise<number>((resolve, reject) => {
    const server: any = app.listen({
      port: 0,
      host: '127.0.0.1',
      onListen: (address) => resolve(address.port),
    })
    server?.once?.('error', reject)
  })

  const url = `http://127.0.0.1:${port}`
  return {
    url,
    port,
    request: (path, init) => fetch(url + path, init),
    close: () => app.close(),
  }
}
