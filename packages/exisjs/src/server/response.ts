import { ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import type { CookieOptions, Request as IRequest } from '../types'
import { logger } from '../logger/index'
import { SSEStream, type SSEOptions } from './sse'
import type { DownloadOptions } from './download'
import {
  serializeCookie,
  serializeClearCookie,
  generateETag,
  nativeStringify,
  streamToResponse,
} from './helpers'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const contentDispositionLib = require('content-disposition')
// v2 exports { create }; v1 exported the function itself
const contentDisposition: (filename: string) => string =
  typeof contentDispositionLib === 'function'
    ? contentDispositionLib
    : contentDispositionLib.create
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mime = require('mime-types')

export class ExisResponse<TResponse = any> {
  // A property to store back-reference to request for freshness checks
  public req?: IRequest
  public etagEnabled = false
  public _onFinish: (() => void)[] = []
  public _serializer?: (data: unknown) => string
  public _onDone?: () => void

  constructor(public raw: ServerResponse) {}

  public init(raw: ServerResponse): this {
    this.raw = raw
    this.req = undefined
    this.etagEnabled = false
    this._onFinish.length = 0
    this._serializer = undefined
    this._onDone = undefined
    return this
  }

  get headersSent(): boolean {
    return this.raw.headersSent
  }

  get isWritable(): boolean {
    return (
      !this.raw.destroyed &&
      !(this.raw as any).writableEnded &&
      !this.raw.headersSent
    )
  }

  get statusCode(): number {
    return this.raw.statusCode
  }

  set statusCode(code: number) {
    this.raw.statusCode = code
  }

  getHeader(name: string) {
    if (this.raw.destroyed) return undefined
    return this.raw.getHeader(name)
  }

  getHeaders() {
    if (this.raw.destroyed) return {}
    return this.raw.getHeaders()
  }

  setHeader(name: string, value: string | number | readonly string[]) {
    if (this.raw.destroyed || this.raw.headersSent) return
    this.raw.setHeader(name, value)
  }

  hasHeader(name: string): boolean {
    if (this.raw.destroyed) return false
    return this.raw.hasHeader(name)
  }

  end(data?: unknown) {
    if (this.raw.destroyed || (this.raw as any).writableEnded) return
    if (this._onFinish.length === 0) {
      // Common case: no finish hooks, so skip the completion callback that
      // would make Node register a 'finish' listener for every response
      this.raw.end(data)
      this._markDone()
      return
    }
    this.raw.end(data, () => {
      // eslint-disable-next-line @typescript-eslint/prefer-for-of
      for (let i = 0; i < this._onFinish.length; i++) {
        this._onFinish[i]()
      }
      this._markDone()
    })
  }

  // 304 only applies to conditional requests; check the cheap request
  // headers first so ordinary responses skip two hasHeader() calls
  private _isNotModified(): boolean {
    const req = this.req
    if (req === undefined) return false
    const h = req.headers
    if (
      h === undefined ||
      (h['if-none-match'] === undefined && h['if-modified-since'] === undefined)
    ) {
      return false
    }
    return (
      (this.raw.hasHeader('ETag') || this.raw.hasHeader('Last-Modified')) &&
      req.fresh
    )
  }

  private _markDone(): void {
    const cb = this._onDone
    if (cb !== undefined) {
      this._onDone = undefined
      cb()
    }
  }

  /**
   * Sets the HTTP response status code.
   *
   * @param code HTTP status code (e.g. `200`, `201`, `400`, `404`, `500`)
   * @returns Response instance for chaining
   *
   * @example
   * ```ts
   * res.status(201).json({ created: true })
   * ```
   */
  status(code: number): this {
    if (this.raw.destroyed || this.raw.headersSent) return this
    this.raw.statusCode = code
    return this
  }

  /**
   * Sets a response header field to a specific value.
   *
   * @param header Header name
   * @param value Header value or array of values
   * @returns Response instance for chaining
   */
  set(header: string, value: string | string[]): this {
    this.setHeader(header, value as string | string[])
    return this
  }

  /**
   * Sets a response header field (alias for `res.set()`).
   */
  header(name: string, value: string | string[]): this {
    return this.set(name, value)
  }

  /**
   * Sets status code and sends its numeric string representation.
   */
  sendStatus(code: number): void {
    this.statusCode = code
    this.send(String(code))
  }

  removeHeader(name: string): this {
    this.raw.removeHeader(name)
    return this
  }

  setStrHeaders(headers: Record<string, string>): this {
    for (const [key, value] of Object.entries(headers)) {
      this.setHeader(key, value)
    }
    return this
  }

  /**
   * Appends an additional value to an existing header field (e.g. `Set-Cookie`, `Link`, `Warning`).
   */
  append(field: string, value: string | string[]): this {
    const prev = this.getHeader(field)
    let finalValue: string | string[] = value

    if (prev) {
      const prevArr = Array.isArray(prev) ? prev : [String(prev)]
      const newArr = Array.isArray(value) ? value : [String(value)]
      finalValue = prevArr.concat(newArr)
    }

    this.setHeader(field, finalValue)
    return this
  }

  /**
   * Sends a string, Buffer, or object response to the client.
   *
   * @param body Response payload (string, Buffer, or object)
   *
   * @example
   * ```ts
   * res.send('Hello World')
   * ```
   */
  send(body: string | Buffer | object): void {
    if (!this.isWritable) return

    if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
      this.json(body as any)
      return
    }

    const isBuffer = Buffer.isBuffer(body)

    if (!this.raw.hasHeader('Content-Type')) {
      this.raw.setHeader(
        'Content-Type',
        isBuffer ? 'application/octet-stream' : 'text/plain; charset=utf-8'
      )
    }

    if (this.etagEnabled && !this.raw.hasHeader('ETag')) {
      const buf = isBuffer
        ? (body as Buffer)
        : Buffer.from(body as string, 'utf8')
      this.raw.setHeader('ETag', generateETag(buf))
    }

    if (this._isNotModified()) {
      this.statusCode = 304
      this.end()
      return
    }

    if (!this.raw.hasHeader('Content-Length')) {
      const len = isBuffer
        ? (body as Buffer).length
        : Buffer.byteLength(body as string)
      this.raw.setHeader('Content-Length', len)
    }
    this.end(body)
  }

  /**
   * Sends a JSON response with automatic native serialization and fast ETag support.
   *
   * @param data JSON-serializable data payload
   *
   * @example
   * ```ts
   * res.json({ success: true, users: ['Alice', 'Bob'] })
   * ```
   */
  json(data: unknown extends TResponse ? any : TResponse): void {
    if (!this.isWritable) return

    let payload: Buffer | string
    try {
      const useSerializer = this._serializer && this.statusCode < 400
      if (useSerializer) {
        try {
          payload = this._serializer!(data)
        } catch {
          payload = nativeStringify(data)
        }
      } else {
        payload = nativeStringify(data)
      }
    } catch (err) {
      try {
        payload = nativeStringify(data)
      } catch (innerErr) {
        if (this.req && this.req.log) {
          this.req.log.error(
            { err: innerErr || err },
            '[ExisJS] Serialization error'
          )
        } else {
          logger.error({ err: innerErr || err }, '[ExisJS] Serialization error')
        }
        this.statusCode = 500
        this.raw.setHeader('Content-Type', 'application/json; charset=utf-8')
        this.end('{"error":"Failed to serialize response"}')
        return
      }
    }

    if (!this.raw.hasHeader('Content-Type')) {
      this.raw.setHeader('Content-Type', 'application/json; charset=utf-8')
    }

    if (!this.raw.hasHeader('Content-Length')) {
      const len = Buffer.isBuffer(payload)
        ? payload.length
        : Buffer.byteLength(payload)
      this.raw.setHeader('Content-Length', len)
    }

    if (this.etagEnabled && !this.raw.hasHeader('ETag')) {
      const buf = Buffer.isBuffer(payload)
        ? payload
        : Buffer.from(payload, 'utf8')
      this.raw.setHeader('ETag', generateETag(buf))
    }

    if (this._isNotModified()) {
      this.statusCode = 304
      this.end()
      return
    }

    this.end(payload)
  }

  /**
   * Sends an HTML response with `Content-Type: text/html; charset=utf-8`.
   *
   * @param content HTML string
   *
   * @example
   * ```ts
   * res.html('<h1>Welcome to ExisJS</h1>')
   * ```
   */
  html(content: string): void {
    if (!this.isWritable) return
    if (!this.hasHeader('Content-Type')) {
      this.setHeader('Content-Type', 'text/html; charset=utf-8')
    }
    this.end(content)
  }

  /**
   * Performs an HTTP redirect to a given URL with an optional status code (defaults to 302).
   *
   * @param url Target destination URL
   * @param code HTTP status code (`301` Moved Permanently, `302` Found, `307` Temporary Redirect, `308` Permanent Redirect)
   *
   * @example
   * ```ts
   * res.redirect('/login')
   * ```
   */
  redirect(url: string, code = 302): void {
    if (!this.isWritable) return
    this.statusCode = code
    this.setHeader('Location', url)
    this.end()
  }

  /**
   * Streams a Node.js Readable stream, Web standard `ReadableStream`, or `AsyncIterable` generator
   * to the client with native backpressure handling and client disconnect auto-cancellation.
   *
   * @param readable Stream or async generator instance
   *
   * @example
   * ```ts
   * // Streaming from an AI SDK or Web stream:
   * res.sendStream(aiResponse.toReadableStream())
   * ```
   */
  sendStream(
    readable: NodeJS.ReadableStream | ReadableStream | AsyncIterable<any>
  ): void {
    streamToResponse(
      this.raw,
      readable,
      this.isWritable,
      this.headersSent,
      (name) => this.hasHeader(name),
      (name, val) => this.setHeader(name, val),
      (code) => {
        this.statusCode = code
      },
      (data) => this.end(data),
      this.req
    )
  }

  /**
   * Alias for `sendStream()`.
   */
  stream(
    readable: NodeJS.ReadableStream | ReadableStream | AsyncIterable<any>
  ): void {
    this.sendStream(readable)
  }

  /**
   * Initializes a Server-Sent Events (SSE) stream for real-time data and AI token streaming.
   *
   * Sets standard SSE headers automatically:
   * - `Content-Type: text/event-stream; charset=utf-8`
   * - `Cache-Control: no-cache, no-transform`
   * - `Connection: keep-alive`
   * - `X-Accel-Buffering: no`
   *
   * @param optionsOrHandler Optional SSE configuration or callback handler
   * @param maybeHandler Callback handler when options object is provided
   * @returns Active `SSEStream` instance
   *
   * @example
   * ```ts
   * // In route.ts
   * export default controller({
   *   events: route.get('/events', {
   *     async handle({ res }) {
   *       res.sse(async (sse) => {
   *         sse.send({ event: 'ping', data: { time: Date.now() } })
   *         await sse.pipeFrom(openAiStream)
   *         sse.close()
   *       })
   *     }
   *   })
   * })
   * ```
   */
  sse(
    optionsOrHandler?: SSEOptions | ((sse: SSEStream) => void | Promise<void>),
    maybeHandler?: (sse: SSEStream) => void | Promise<void>
  ): SSEStream {
    let options: SSEOptions = {}
    let handler: ((sse: SSEStream) => void | Promise<void>) | undefined

    if (typeof optionsOrHandler === 'function') {
      handler = optionsOrHandler
    } else if (
      typeof optionsOrHandler === 'object' &&
      optionsOrHandler !== null
    ) {
      options = optionsOrHandler
      if (typeof maybeHandler === 'function') {
        handler = maybeHandler
      }
    }

    if (!this.raw.headersSent) {
      this.statusCode = 200
      this.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      this.setHeader('Cache-Control', 'no-cache, no-transform')
      this.setHeader('Connection', 'keep-alive')
      this.setHeader('X-Accel-Buffering', 'no')

      if (options.headers) {
        for (const [key, value] of Object.entries(options.headers)) {
          this.setHeader(key, value)
        }
      }

      if (typeof this.raw.flushHeaders === 'function') {
        this.raw.flushHeaders()
      }
    }

    const stream = new SSEStream(this.raw, options, this.req?.raw)

    if (handler) {
      try {
        const res = handler(stream)
        if (res instanceof Promise) {
          res.catch((err) => {
            if (this.req && this.req.log) {
              this.req.log.error(
                { err },
                '[ExisJS] Error in SSE stream handler'
              )
            } else {
              logger.error({ err }, '[ExisJS] Error in SSE stream handler')
            }
            if (!stream.isClosed) {
              stream.close()
            }
          })
        }
      } catch (err) {
        if (this.req && this.req.log) {
          this.req.log.error({ err }, '[ExisJS] Error in SSE stream handler')
        } else {
          logger.error({ err }, '[ExisJS] Error in SSE stream handler')
        }
        if (!stream.isClosed) {
          stream.close()
        }
      }
    }

    return stream
  }

  /**
   * Sends a file as an attachment, with `Content-Disposition` and a MIME type
   * inferred from the filename.
   *
   * A **string is always a path to a file on disk**, never content. To send
   * generated text, pass a `Buffer` or stream, or return `download(text,
   * name)` from `exisjs/response`. When any part of the path comes from the
   * request, pass `root`: paths resolving outside it answer 404.
   *
   * @param fileOrData File path, or a Buffer / stream of content
   * @param filename Name the browser saves the file as (defaults to the file's basename)
   * @param options `contentType`, extra `headers`, and `root` for file paths
   *
   * @example
   * ```ts
   * res.download('./storage/annual-report.pdf', 'Annual-Report-2026.pdf')
   * res.download(req.params.file, undefined, { root: './storage/exports' })
   * res.download(csvBuffer, 'sales.csv')
   * res.download(stream, 'export.xlsx')
   * ```
   */
  download(
    fileOrData:
      | string
      | Buffer
      | NodeJS.ReadableStream
      | ReadableStream
      | AsyncIterable<any>,
    filename?: string,
    options?: DownloadOptions
  ): void {
    if (this.headersSent) return

    if (typeof fileOrData === 'string') {
      this._downloadFile(fileOrData, filename, options)
      return
    }

    this._setDownloadHeaders(filename || 'download', options)

    if (Buffer.isBuffer(fileOrData)) {
      if (!this.hasHeader('Content-Length')) {
        this.setHeader('Content-Length', fileOrData.length)
      }
      this.end(fileOrData)
      return
    }

    this.sendStream(fileOrData)
  }

  private _setDownloadHeaders(name: string, options?: DownloadOptions): void {
    this.setHeader('Content-Disposition', contentDisposition(name))
    if (options?.contentType) {
      this.setHeader('Content-Type', options.contentType)
    } else if (!this.hasHeader('Content-Type')) {
      this.setHeader(
        'Content-Type',
        mime.lookup(name) || 'application/octet-stream'
      )
    }
    if (options?.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        this.setHeader(k, v)
      }
    }
  }

  private _downloadFile(
    filePath: string,
    filename: string | undefined,
    options?: DownloadOptions
  ): void {
    const notFound = () => {
      if (!this.isWritable) return
      ;(this as ExisResponse<any>).status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'File not found' },
      })
    }

    // With a root, the resolved path must stay inside it, which defeats
    // "../" segments and absolute paths in request-supplied names
    const root = options?.root ? path.resolve(options.root) : undefined
    const full = root ? path.resolve(root, filePath) : path.resolve(filePath)
    if (
      filePath.indexOf(String.fromCharCode(0)) !== -1 ||
      (root !== undefined && !full.startsWith(root + path.sep))
    ) {
      notFound()
      return
    }

    // Headers are only set once the file is known to exist, so a 404 does
    // not carry attachment headers
    fs.stat(full, (err, stat) => {
      if (err || !stat.isFile()) {
        notFound()
        return
      }
      if (!this.isWritable) return
      this._setDownloadHeaders(filename || path.basename(full), options)
      this.setHeader('Content-Length', stat.size)
      this.sendStream(fs.createReadStream(full))
    })
  }

  /**
   * Sets Content-Type header using file extension or MIME type string.
   *
   * @example
   * ```ts
   * res.type('json') // sets 'application/json; charset=utf-8'
   * res.type('png')  // sets 'image/png'
   * ```
   */
  type(type: string): this {
    const mimeType = mime.contentType(type) || type
    this.setHeader('Content-Type', mimeType)
    return this
  }

  /**
   * Sets Link header field with pagination or resource relations.
   */
  links(links: Record<string, string>): this {
    let linkHeader = this.getHeader('Link') || ''
    if (Array.isArray(linkHeader)) linkHeader = linkHeader.join(', ')

    const parts = Object.keys(links).map(
      (rel) => `<${links[rel]}>; rel="${rel}"`
    )
    const newLinks = parts.join(', ')

    this.setHeader('Link', linkHeader ? `${linkHeader}, ${newLinks}` : newLinks)
    return this
  }

  /**
   * Adds a field to the Vary header if not already present.
   */
  vary(field: string): this {
    if (!field) return this

    let varyHeader = this.getHeader('Vary') || ''
    if (Array.isArray(varyHeader)) varyHeader = varyHeader.join(', ')

    if (!varyHeader) {
      this.setHeader('Vary', field)
      return this
    }

    const fields = (varyHeader as string)
      .split(',')
      .map((f) => f.trim().toLowerCase())
    if (!fields.includes(field.toLowerCase()) && !fields.includes('*')) {
      this.setHeader('Vary', `${varyHeader}, ${field}`)
    }

    return this
  }

  /**
   * Sets a cookie with specified security options.
   *
   * @param name Cookie name
   * @param value Cookie value
   * @param options Cookie options (httpOnly, secure, sameSite, maxAge, path, domain)
   *
   * @example
   * ```ts
   * res.cookie('session_token', token, {
   *   httpOnly: true,
   *   secure: true,
   *   sameSite: 'lax',
   *   maxAge: 86400000 // 1 day
   * })
   * ```
   */
  cookie(name: string, value: string, options: CookieOptions = {}): this {
    const serialized = serializeCookie(name, value, options)
    this.append('Set-Cookie', serialized)
    if (process.env.NODE_ENV === 'development') {
      this.append('X-Set-Cookie', serialized)
    }
    return this
  }

  /**
   * Clears a cookie by setting its expiration to the past.
   *
   * @param name Cookie name
   * @param options Cookie options (path, domain)
   *
   * @example
   * ```ts
   * res.clearCookie('session_token')
   * ```
   */
  clearCookie(name: string, options: CookieOptions = {}): this {
    const serialized = serializeClearCookie(name, options)
    this.append('Set-Cookie', serialized)
    if (process.env.NODE_ENV === 'development') {
      this.append('X-Set-Cookie', serialized)
    }
    return this
  }
}
