import { ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import type { CookieOptions, Request as IRequest } from '../types'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const contentDisposition = require('content-disposition')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mime = require('mime-types')

function generateETag(content: Buffer): string {
  let h = 0x811c9dc5
  for (const byte of content) {
    h ^= byte
    h = (h * 0x01000193) >>> 0
  }
  return `W/"${content.length.toString(16)}-${h.toString(16)}"`
}

export class ExisResponse<TResponse = any> {
  // A property to store back-reference to request for freshness checks
  public req?: IRequest
  public etagEnabled = false
  public _onFinish: (() => void)[] = []
  public _serializer?: (data: unknown) => string

  constructor(public raw: ServerResponse) {}

  get headersSent(): boolean {
    return this.raw.headersSent
  }

  get statusCode(): number {
    return this.raw.statusCode
  }

  set statusCode(code: number) {
    this.raw.statusCode = code
  }

  getHeader(name: string) {
    return this.raw.getHeader(name)
  }

  setHeader(name: string, value: string | number | readonly string[]) {
    this.raw.setHeader(name, value)
  }

  hasHeader(name: string): boolean {
    return this.raw.hasHeader(name)
  }

  end(data?: unknown) {
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
    if (this.raw.headersSent) return

    if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
      this.json(body as any)
      return
    }

    const isBuffer = Buffer.isBuffer(body)
    const content = isBuffer ? body : Buffer.from(body, 'utf8')

    if (!this.raw.hasHeader('Content-Type')) {
      this.raw.setHeader(
        'Content-Type',
        isBuffer ? 'application/octet-stream' : 'text/plain; charset=utf-8'
      )
    }

    if (this.etagEnabled && !this.raw.hasHeader('ETag')) {
      this.raw.setHeader('ETag', generateETag(content))
    }

    if (this.req && this.req.fresh) {
      this.statusCode = 304
      this.end()
      return
    }

    this.raw.setHeader('Content-Length', content.length)
    this.end(content)
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
    if (this.raw.headersSent) return

    let str: string
    try {
      const useSerializer = this._serializer && this.statusCode < 400
      str = useSerializer ? this._serializer!(data) : JSON.stringify(data)
    } catch (err) {
      console.error('[ExisJS] Serialization error:', err)
      this.statusCode = 500
      this.raw.setHeader('Content-Type', 'application/json; charset=utf-8')
      this.end('{"error":"Failed to serialize response"}')
      return
    }

    if (this.req?.fresh) {
      this.statusCode = 304
      this.end()
      return
    }

    if (!this.raw.hasHeader('Content-Type')) {
      this.raw.setHeader('Content-Type', 'application/json; charset=utf-8')
    }

    const byteLen = Buffer.byteLength(str, 'utf8')

    if (this.etagEnabled && !this.raw.hasHeader('ETag')) {
      this.raw.setHeader('ETag', generateETag(Buffer.from(str, 'utf8')))
    }

    this.raw.setHeader('Content-Length', byteLen)
    this.end(str)
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
    if (this.headersSent) return
    if (!this.hasHeader('Content-Type')) {
      this.setHeader('Content-Type', 'text/html; charset=utf-8')
    }
    const buf = Buffer.from(content, 'utf8')
    this.setHeader('Content-Length', buf.length)
    this.end(buf)
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
    if (this.headersSent) return
    this.statusCode = code
    this.setHeader('Location', url)
    this.end()
  }

  sendStream(readable: NodeJS.ReadableStream): void {
    if (this.headersSent) return
    if (!this.hasHeader('Content-Type')) {
      this.setHeader('Content-Type', 'application/octet-stream')
    }
    readable.pipe(this.raw as unknown as NodeJS.WritableStream)
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
    if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)

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
   * @return {this}
   * @public
   */
  clearCookie(name: string): this {
    return this.cookie(name, '', { expires: new Date(0), httpOnly: true })
  }
}
