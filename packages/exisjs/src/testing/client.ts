import http from 'node:http'
import { App } from '../server/app'

export interface TestResponse {
  status: number
  headers: http.IncomingHttpHeaders

  body: any
  text: string
}

export class TestRequest {
  private _app: App
  private _method: string
  private _path: string
  private _body?: unknown
  private _headers: Record<string, string> = {}
  private _expectedStatus?: number
  private _expectedHeaders: Record<string, string | RegExp> = {}
  private _expectedBody?: unknown

  constructor(app: App, method: string, path: string) {
    this._app = app
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
    const payload = this._body

    try {
      const res = await this._app.inject({
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
      // Very basic deep equality check for testing
      const expectedStr = JSON.stringify(this._expectedBody)
      const actualStr = JSON.stringify(res.body)
      if (expectedStr !== actualStr) {
        throw new Error(`Expected body ${expectedStr}, got ${actualStr}`)
      }
    }
  }
}

export interface TestApp {
  get(path: string): TestRequest
  post(path: string): TestRequest
  put(path: string): TestRequest
  patch(path: string): TestRequest
  delete(path: string): TestRequest
  options(path: string): TestRequest
  head(path: string): TestRequest
  query(path: string): TestRequest
  trace(path: string): TestRequest
  connect(path: string): TestRequest
  request(method: string, path: string): TestRequest
}

export function createTestApp(app: App): TestApp {
  return {
    get: (path) => new TestRequest(app, 'GET', path),
    post: (path) => new TestRequest(app, 'POST', path),
    put: (path) => new TestRequest(app, 'PUT', path),
    patch: (path) => new TestRequest(app, 'PATCH', path),
    delete: (path) => new TestRequest(app, 'DELETE', path),
    options: (path) => new TestRequest(app, 'OPTIONS', path),
    head: (path) => new TestRequest(app, 'HEAD', path),
    query: (path) => new TestRequest(app, 'QUERY', path),
    trace: (path) => new TestRequest(app, 'TRACE', path),
    connect: (path) => new TestRequest(app, 'CONNECT', path),
    request: (method, path) => new TestRequest(app, method, path),
  }
}
