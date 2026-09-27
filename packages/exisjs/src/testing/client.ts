import http from 'node:http'
import { App } from '../server/app'
import type { ExisAppDefinition } from '../server/define'

export interface TestResponse {
  status: number
  headers: http.IncomingHttpHeaders

  body: any
  text: string
}

export class TestRequest {
  private _appSource: App | ExisAppDefinition
  private _appPromise?: Promise<App>
  private _app?: App
  private _method: string
  private _path: string
  private _body?: unknown
  private _headers: Record<string, string> = {}
  private _expectedStatus?: number
  private _expectedHeaders: Record<string, string | RegExp> = {}
  private _expectedBody?: unknown

  constructor(app: App | ExisAppDefinition, method: string, path: string) {
    this._appSource = app
    this._method = method
    this._path = path
  }

  send(body: unknown): this {
    this._body = body
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
    if (!this._app) {
      if (
        (this._appSource as any)._isExisAppDefinition ||
        (this._appSource as any).__isAppDefinition ||
        typeof (this._appSource as any).boot === 'function'
      ) {
        if (!(this._appSource as any)._bootPromise) {
          ;(this._appSource as any)._bootPromise = (
            this._appSource as ExisAppDefinition
          ).boot()
        }
        this._app = await (this._appSource as any)._bootPromise
      } else {
        this._app = this._appSource as App
      }
    }

    const payload = this._body

    try {
      const res = await this._app!.inject({
        method: this._method,
        url: this._path,
        headers: this._headers,
        body: payload,
      })

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
}

export interface TestApp {
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

function applyRequestOptions(
  req: TestRequest,
  options?: RequestOptions | unknown
): TestRequest {
  if (!options) return req
  if (
    typeof options === 'object' &&
    options !== null &&
    ('headers' in options || 'body' in options)
  ) {
    const opt = options as RequestOptions
    if (opt.headers) {
      for (const [k, v] of Object.entries(opt.headers)) {
        req.set(k, String(v))
      }
    }
    if (opt.body !== undefined) {
      req.send(opt.body)
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
    get: (path, opts) =>
      applyRequestOptions(new TestRequest(finalApp, 'GET', path), opts),
    post: (path, opts) =>
      applyRequestOptions(new TestRequest(finalApp, 'POST', path), opts),
    put: (path, opts) =>
      applyRequestOptions(new TestRequest(finalApp, 'PUT', path), opts),
    patch: (path, opts) =>
      applyRequestOptions(new TestRequest(finalApp, 'PATCH', path), opts),
    delete: (path, opts) =>
      applyRequestOptions(new TestRequest(finalApp, 'DELETE', path), opts),
    options: (path, opts) =>
      applyRequestOptions(new TestRequest(finalApp, 'OPTIONS', path), opts),
    head: (path, opts) =>
      applyRequestOptions(new TestRequest(finalApp, 'HEAD', path), opts),
    query: (path, opts) =>
      applyRequestOptions(new TestRequest(finalApp, 'QUERY', path), opts),
    trace: (path, opts) =>
      applyRequestOptions(new TestRequest(finalApp, 'TRACE', path), opts),
    connect: (path, opts) =>
      applyRequestOptions(new TestRequest(finalApp, 'CONNECT', path), opts),
    request: (method, path, opts) =>
      applyRequestOptions(new TestRequest(finalApp, method, path), opts),
  }
}
