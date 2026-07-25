import { createClient } from '../src/index'

describe('tRPC-Style Client', () => {
  beforeEach(() => {
    // Mock the global fetch
    global.fetch = jest.fn(async function (url: any, options?: any) {
      let body: any = null

      if (options?.body && typeof options.body === 'string') {
        body = JSON.parse(options.body)
      }

      return {
        ok: true,
        status: 200,
        clone: function () {
          return this
        },
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async function () {
          return {
            url: url.toString(),
            method: options?.method,
            headers: Array.from(new Headers(options?.headers || {}).entries()),
            body,
          }
        },
        text: async function () {
          return 'ok'
        },
      } as any
    }) as any
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  type TestRouter = {
    '/api/users': { get: any }
    '/api/posts': { post: any }
    '/api/search': { get: any }
  }

  it('translates object paths to fetch calls perfectly', async () => {
    const client = createClient<TestRouter>({
      baseUrl: 'http://localhost:3000',
    })

    // Simulate: client.api.users.get()
    const result = await client.api.users.get()

    expect(result.url).toBe('http://localhost:3000/api/users')
    expect(result.method).toBe('GET')
    expect(result.body).toBe(null)
  })

  it('handles post requests with payloads', async () => {
    const client = createClient<TestRouter>({
      baseUrl: 'http://localhost:3000',
    })

    // Simulate: client.api.posts.post({ title: 'Hello World' })
    const result = await client.api.posts.post({ title: 'Hello World' })

    expect(result.url).toBe('http://localhost:3000/api/posts')
    expect(result.method).toBe('POST')
    expect(result.body).toEqual({ title: 'Hello World' })

    // Check headers
    const hasContentType = result.headers.some(
      ([k, v]: [string, string]) =>
        k === 'content-type' && v === 'application/json'
    )
    expect(hasContentType).toBe(true)
  })

  it('merges global options with request options', async () => {
    const client = createClient<TestRouter>({
      baseUrl: 'http://localhost:3000',
      headers: { Authorization: 'Bearer 123' },
    })

    // Provide explicit query and additional headers
    const result = await client.api.search.get(null, {
      query: { q: 'test' },
      headers: { 'X-Custom': '456' },
    })

    expect(result.url).toBe('http://localhost:3000/api/search?q=test')
    expect(result.method).toBe('GET')

    const hasAuth = result.headers.some(
      ([k, v]: [string, string]) => k === 'authorization' && v === 'Bearer 123'
    )
    const hasCustom = result.headers.some(
      ([k, v]: [string, string]) => k === 'x-custom' && v === '456'
    )
    expect(hasAuth).toBe(true)
    expect(hasCustom).toBe(true)
  })

  it('throws ExisClientError on non-200 responses', async () => {
    const customFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Bad Request' }),
      clone: function () {
        return this
      },
    })

    const client = createClient<TestRouter>({
      baseUrl: 'http://localhost:3000',
      fetch: customFetch as any,
    })

    await expect(client.api.users.get()).rejects.toThrow(
      'Request failed with status 400'
    )

    try {
      await client.api.users.get()
    } catch (err: any) {
      expect(err.name).toBe('ExisClientError')
      expect(err.status).toBe(400)
      expect(err.data).toEqual({ error: 'Bad Request' })
    }
  })

  it('executes lifecycle interceptors correctly', async () => {
    const onRequest = jest.fn()
    const onResponse = jest.fn()

    const customFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true }),
      clone: function () {
        return this
      },
    })

    const client = createClient<TestRouter>({
      baseUrl: 'http://localhost:3000',
      fetch: customFetch as any,
      onRequest,
      onResponse,
    })

    await client.api.users.get()

    expect(onRequest).toHaveBeenCalledTimes(1)
    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET' }),
      'http://localhost:3000/api/users'
    )

    expect(onResponse).toHaveBeenCalledTimes(1)
    expect(onResponse.mock.calls[0][1]).toBe('http://localhost:3000/api/users')
  })
})
