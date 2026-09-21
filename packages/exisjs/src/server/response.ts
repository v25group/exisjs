import { ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import type { CookieOptions, Request as IRequest } from '../types'
import { logger } from '../logger/index'
import { SSEStream, type SSEOptions } from './sse'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const contentDisposition = require('content-disposition')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mime = require('mime-types')

import { generateEtag, fastJsonStringifyBuffer } from '@exisjs/rs'

function generateETag(content: Buffer): string {
  return generateEtag(content)
}

function nativeStringify(data: unknown): Buffer | string {
  if (data === null || data === undefined) {
    return 'null'
  }
  // If native rust serialization is available, use it
  if (typeof fastJsonStringifyBuffer === 'function') {
    // Validate object can be serialized without throwing V8 check failure on circularity
    const str = JSON.stringify(data)
    if (str.length > 512) {
      // For larger payloads, Rust serde serialization into Buffer gives zero V8 GC overhead
      return fastJsonStringifyBuffer(data)
    }
    return str
  }
  return JSON.stringify(data)
}

export class ExisResponse<TResponse = any> {
  // A property to store back-reference to request for freshness checks
  public req?: IRequest
  public etagEnabled = false
  public _onFinish: (() => void)[] = []
  public _serializer?: (data: unknown) => string

  constructor(public raw: ServerResponse) {}

  public init(raw: ServerResponse): this {
    this.raw = raw
    this.req = undefined
    this.etagEnabled = false
    this._onFinish.length = 0
    this._serializer = undefined
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
    if (this._onFinish.length > 0) {
      this.raw.end(data, () => {
        // eslint-disable-next-line @typescript-eslint/prefer-for-of
        for (let i = 0; i < this._onFinish.length; i++) {
          this._onFinish[i]()
        }
      })
    } else {
      this.raw.end(data)
    }
  }

  /**
   * Set status `code`.
   *
   * @param {number} code
   * @return {this}
   * @public
   */
  status(code: number): this {
    if (this.raw.destroyed || this.raw.headersSent) return this
    this.raw.statusCode = code
    return this
  }

  /**
   * Set header `field` to `val`, or pass
   * an object of header fields.
   *
   * Examples:
   *
   *    res.set('Foo', ['bar', 'baz']);
   *    res.set('Accept', 'application/json');
   *
   * Aliased as `res.header()`.
   *
   * @param {string} header
   * @param {string | string[]} value
   * @return {this}
   * @public
   */
  set(header: string, value: string | string[]): this {
    this.setHeader(header, value as string | string[])
    return this
  }

  /**
   * Set header `field` to `val`, or pass
   * an object of header fields.
   *
   * Alias for `res.set()`.
   *
   * @param {string} name
   * @param {string | string[]} value
   * @return {this}
   * @public
   */
  header(name: string, value: string | string[]): this {
    return this.set(name, value)
  }

  /**
   * Send given HTTP status code.
   *
   * Sets the response status to `code` and the body
   * to the string representation of the `code`.
   *
   * Examples:
   *
   *     res.sendStatus(200);
   *
   * @param {number} code
   * @public
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
   * Append additional header `field` with value `val`.
   *
   * Example:
   *
   *    res.append('Link', ['<http://localhost/>', '<http://localhost:3000/>']);
   *    res.append('Set-Cookie', 'foo=bar; Path=/; HttpOnly');
   *    res.append('Warning', '199 Miscellaneous warning');
   *
   * @param {string} field
   * @param {string | string[]} value
   * @return {this}
   * @public
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
   * Send a response.
   *
   * Examples:
   *
   *     res.send(Buffer.from('wahoo'));
   *     res.send({ some: 'json' });
   *     res.send('<p>some html</p>');
   *
   * @param {string | Buffer | object} body
   * @public
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

    if (
      this.req &&
      (this.raw.hasHeader('ETag') || this.raw.hasHeader('Last-Modified')) &&
      this.req.fresh
    ) {
      this.statusCode = 304
      this.end()
      return
    }

    // Rely on Node.js core to automatically calculate Content-Length
    // for strings in res.end() rather than creating a Buffer here.
    if (isBuffer && !this.raw.hasHeader('Content-Length')) {
      this.raw.setHeader('Content-Length', (body as Buffer).length)
    }
    this.end(body)
  }

  /**
   * Send JSON response.
   *
   * Examples:
   *
   *     res.json(null);
   *     res.json({ user: 'tj' });
   *
   * @param {unknown} data
   * @public
   */
  json(data: unknown extends TResponse ? any : TResponse): void {
    if (!this.isWritable) return

    let payload: Buffer | string
    try {
      const useSerializer = this._serializer && this.statusCode < 400
      payload = useSerializer ? this._serializer!(data) : nativeStringify(data)
    } catch (err) {
      if (this.req && this.req.log) {
        this.req.log.error({ err }, '[ExisJS] Serialization error')
      } else {
        logger.error({ err }, '[ExisJS] Serialization error')
      }
      this.statusCode = 500
      this.raw.setHeader('Content-Type', 'application/json; charset=utf-8')
      this.end('{"error":"Failed to serialize response"}')
      return
    }

    if (!this.raw.hasHeader('Content-Type')) {
      this.raw.setHeader('Content-Type', 'application/json; charset=utf-8')
    }

    if (this.etagEnabled && !this.raw.hasHeader('ETag')) {
      const buf = Buffer.isBuffer(payload)
        ? payload
        : Buffer.from(payload, 'utf8')
      this.raw.setHeader('ETag', generateETag(buf))
    }

    if (
      this.req &&
      (this.raw.hasHeader('ETag') || this.raw.hasHeader('Last-Modified')) &&
      this.req.fresh
    ) {
      this.statusCode = 304
      this.end()
      return
    }

    this.end(payload)
  }

  /**
   * Send HTML response.
   *
   * Examples:
   *
   *     res.html('<h1>Hello</h1>');
   *
   * @param {string} content
   * @public
   */
  html(content: string): void {
    if (!this.isWritable) return
    if (!this.hasHeader('Content-Type')) {
      this.setHeader('Content-Type', 'text/html; charset=utf-8')
    }
    this.end(content)
  }

  /**
   * Redirect to the given `url` with optional response `status`
   * defaulting to 302.
   *
   * Examples:
   *
   *     res.redirect('/foo/bar');
   *     res.redirect('http://example.com');
   *     res.redirect('http://example.com', 301);
   *
   * @param {string} url
   * @param {number} [code=302]
   * @public
   */
  redirect(url: string, code = 302): void {
    if (!this.isWritable) return
    this.statusCode = code
    this.setHeader('Location', url)
    this.end()
  }

  /**
   * Stream a Node.js Readable stream, Web standard ReadableStream, or AsyncIterable
   * to the client with native HTTP backpressure handling and automatic cancellation
   * if the client disconnects prematurely.
   */
  sendStream(
    readable: NodeJS.ReadableStream | ReadableStream | AsyncIterable<any>
  ): void {
    if (!this.isWritable) {
      if (typeof (readable as any).destroy === 'function') {
        ;(readable as any).destroy()
      } else if (typeof (readable as any).cancel === 'function') {
        ;(readable as any).cancel().catch(() => {
          /* ignore */
        })
      }
      return
    }

    if (!this.hasHeader('Content-Type')) {
      this.setHeader('Content-Type', 'application/octet-stream')
    }

    // 1. Web Standard ReadableStream (e.g. from fetch, OpenAI, Anthropic, AI SDKs)
    if (typeof (readable as any).getReader === 'function') {
      const reader = (readable as any).getReader()
      let closed = false

      const cleanup = () => {
        if (closed) return
        closed = true
        try {
          reader.cancel().catch(() => {
            /* ignore */
          })
        } catch {
          // ignore
        }
      }

      this.raw.once('close', cleanup)
      if (this.req && (this.req as any).raw) {
        ;(this.req as any).raw.once('close', cleanup)
        ;(this.req as any).raw.once('aborted', cleanup)
      }

      ;(async () => {
        try {
          while (true) {
            if (closed || this.raw.destroyed) {
              cleanup()
              break
            }
            const { done, value } = await reader.read()
            if (done) {
              this.raw.removeListener('close', cleanup)
              if (!this.raw.writableEnded && !this.raw.destroyed) {
                this.end()
              }
              break
            }
            if (value !== undefined && value !== null) {
              const ok = this.raw.write(value)
              if (!ok && !this.raw.destroyed && !this.raw.writableEnded) {
                await new Promise<void>((resolve) =>
                  this.raw.once('drain', resolve)
                )
              }
            }
          }
        } catch (err: any) {
          cleanup()
          if (this.req && this.req.log) {
            this.req.log.error({ err }, '[ExisJS] Error in Web ReadableStream')
          } else {
            logger.error({ err }, '[ExisJS] Error in Web ReadableStream')
          }
          if (this.isWritable && !this.headersSent) {
            this.statusCode = 500
            this.end('{"error":"Stream transmission failed"}')
          } else if (!this.raw.destroyed) {
            this.raw.destroy(err)
          }
        }
      })()
      return
    }

    // 2. AsyncIterable / Generator stream
    if (
      typeof (readable as any)[Symbol.asyncIterator] === 'function' &&
      typeof (readable as any).pipe !== 'function'
    ) {
      let closed = false
      const cleanup = () => {
        closed = true
        if (typeof (readable as any).return === 'function') {
          ;(readable as any).return().catch(() => {
            /* ignore */
          })
        }
      }

      this.raw.once('close', cleanup)
      if (this.req && (this.req as any).raw) {
        ;(this.req as any).raw.once('close', cleanup)
      }

      ;(async () => {
        try {
          for await (const chunk of readable as AsyncIterable<any>) {
            if (closed || this.raw.destroyed) break
            if (chunk !== undefined && chunk !== null) {
              const payload =
                typeof chunk === 'string' || Buffer.isBuffer(chunk)
                  ? chunk
                  : JSON.stringify(chunk)
              const ok = this.raw.write(payload)
              if (!ok && !this.raw.destroyed && !this.raw.writableEnded) {
                await new Promise<void>((resolve) =>
                  this.raw.once('drain', resolve)
                )
              }
            }
          }
          this.raw.removeListener('close', cleanup)
          if (!this.raw.writableEnded && !this.raw.destroyed) {
            this.end()
          }
        } catch (err: any) {
          cleanup()
          if (this.req && this.req.log) {
            this.req.log.error(
              { err },
              '[ExisJS] Error in AsyncIterable stream'
            )
          } else {
            logger.error({ err }, '[ExisJS] Error in AsyncIterable stream')
          }
          if (this.isWritable && !this.headersSent) {
            this.statusCode = 500
            this.end('{"error":"Stream transmission failed"}')
          } else if (!this.raw.destroyed) {
            this.raw.destroy(err)
          }
        }
      })()
      return
    }

    // 3. Standard Node.js Readable Stream
    const cleanup = () => {
      if (
        typeof (readable as any).destroy === 'function' &&
        !(readable as any).destroyed
      ) {
        ;(readable as any).destroy()
      }
    }

    // Auto-destroy stream if client aborts or response closes early
    this.raw.once('close', cleanup)
    if (this.req && (this.req as any).raw) {
      ;(this.req as any).raw.once('close', cleanup)
      ;(this.req as any).raw.once('aborted', cleanup)
    }

    // Handle stream error to prevent process crash
    if (typeof (readable as any).on === 'function') {
      ;(readable as any).once('error', (err: any) => {
        this.raw.removeListener('close', cleanup)
        if (this.req && this.req.log) {
          this.req.log.error({ err }, '[ExisJS] Error in sendStream')
        } else {
          logger.error({ err }, '[ExisJS] Error in sendStream')
        }
        if (this.isWritable && !this.headersSent) {
          this.statusCode = 500
          this.end('{"error":"Stream transmission failed"}')
        } else {
          cleanup()
          if (!this.raw.destroyed) {
            this.raw.destroy(err)
          }
        }
      })
    }

    if (typeof (readable as any).once === 'function') {
      ;(readable as any).once('end', () => {
        this.raw.removeListener('close', cleanup)
      })
    }

    ;(readable as any).pipe(this.raw as unknown as NodeJS.WritableStream)
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
   * Initialize a Server-Sent Events (SSE) stream for real-time and AI streaming.
   *
   * Automatically sets standard SSE headers:
   * - `Content-Type: text/event-stream; charset=utf-8`
   * - `Cache-Control: no-cache, no-transform`
   * - `Connection: keep-alive`
   * - `X-Accel-Buffering: no` (disables Nginx proxy buffering)
   *
   * @param options Optional configuration (heartbeat interval, custom headers)
   * @param handler Optional callback function receiving the active `SSEStream`
   * @returns Active `SSEStream` instance
   *
   * @example
   * // Using callback handler:
   * res.sse(async (sse) => {
   *   sse.send({ event: 'message', data: 'hello' })
   *   await sse.pipeFrom(openaiStream)
   *   sse.close()
   * })
   *
   * // Or assigning to variable:
   * const sse = res.sse()
   * sse.send({ event: 'connected', data: { time: Date.now() } })
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

      // Flush headers immediately
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
   * Transfer the file at the given `filePath` as an attachment.
   *
   * Optionally providing an alternate attachment `filename`,
   * and optional `options`.
   *
   * @param {string} filePath
   * @param {string} [filename]
   * @param {unknown} [options]
   * @public
   */
  download(filePath: string, filename?: string, options?: unknown): void {
    if (this.headersSent) return

    const name = filename || path.basename(filePath)

    this.setHeader('Content-Disposition', contentDisposition(name))

    if (!this.hasHeader('Content-Type')) {
      const type = mime.lookup(name) || 'application/octet-stream'
      this.setHeader('Content-Type', type)
    }

    const stream = fs.createReadStream(
      filePath,
      options as Parameters<typeof fs.createReadStream>[1]
    )

    stream.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        this.statusCode = 404
        this.end('File not found')
      } else {
        this.statusCode = 500
        this.end('Error reading file')
      }
    })

    stream.pipe(this.raw as unknown as NodeJS.WritableStream)
  }

  /**
   * Set _Content-Type_ response header with `type` through `mime.lookup()`
   * when it does not contain "/", or set the Content-Type to `type` otherwise.
   *
   * Examples:
   *
   *     res.type('.html');
   *     res.type('html');
   *     res.type('json');
   *     res.type('application/json');
   *     res.type('png');
   *
   * @param {string} type
   * @return {this}
   * @public
   */
  type(type: string): this {
    const mimeType = mime.contentType(type) || type
    this.setHeader('Content-Type', mimeType)
    return this
  }

  /**
   * Set Link header field with the given `links`.
   *
   * Examples:
   *
   *    res.links({
   *      next: 'http://api.example.com/users?page=2',
   *      last: 'http://api.example.com/users?page=5'
   *    });
   *
   * @param {Record<string, string>} links
   * @return {this}
   * @public
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
   * Add `field` to Vary. If already present in the Vary set, then
   * this call is simply ignored.
   *
   * @param {string} field
   * @return {this}
   * @public
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
   * Set cookie `name` to `value`, with the given `options`.
   *
   * Options:
   *    - `maxAge`   max-age in milliseconds, converted to `expires`
   *    - `path`     cookie path, defaults to '/'
   *    - `domain`   cookie domain
   *    - `secure`   secure cookie
   *    - `httpOnly` httponly cookie
   *    - `sameSite` samesite cookie
   *
   * Examples:
   *
   *    res.cookie('rememberme', '1', { expires: new Date(Date.now() + 900000), httpOnly: true });
   *    res.cookie('cart', '1234');
   *
   * @param {string} name
   * @param {string} value
   * @param {CookieOptions} options
   * @return {this}
   * @public
   */
  cookie(name: string, value: string, options: CookieOptions = {}): this {
    const parts: string[] = [
      `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    ]

    if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`)
    if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`)
    if (options.path ?? true) parts.push(`Path=${options.path ?? '/'}`)
    if (options.domain) parts.push(`Domain=${options.domain}`)
    if (options.httpOnly) parts.push('HttpOnly')
    if (options.secure) parts.push('Secure')

    if (options.sameSite !== undefined && options.sameSite !== false) {
      if (options.sameSite === true) {
        parts.push('SameSite=Strict')
      } else {
        const str = String(options.sameSite).toLowerCase()
        if (str === 'strict') parts.push('SameSite=Strict')
        else if (str === 'lax') parts.push('SameSite=Lax')
        else if (str === 'none') {
          parts.push('SameSite=None')
          if (!options.secure && !parts.includes('Secure')) {
            parts.push('Secure')
          }
        }
      }
    }

    if (options.partitioned) parts.push('Partitioned')
    if (options.priority) {
      const p = options.priority.toLowerCase()
      if (p === 'low') parts.push('Priority=Low')
      else if (p === 'medium') parts.push('Priority=Medium')
      else if (p === 'high') parts.push('Priority=High')
    }

    this.append('Set-Cookie', parts.join('; '))
    if (process.env.NODE_ENV === 'development') {
      this.append('X-Set-Cookie', parts.join('; '))
    }

    return this
  }

  /**
   * Clear cookie `name`.
   *
   * @param {string} name
   * @param {CookieOptions} [options]
   * @return {this}
   * @public
   */
  clearCookie(name: string, options: CookieOptions = {}): this {
    const { maxAge: _, expires: __, ...rest } = options
    return this.cookie(name, '', {
      httpOnly: true,
      ...rest,
      expires: new Date(0),
      maxAge: 0,
    })
  }
}
