import { IncomingMessage } from 'node:http'
import type { Logger } from '../types'
import type { ExisResponse } from './response'
import { HttpError } from '../utils/errors'
import { Dataloader } from '../dataloader/dataloader'
import type { BatchLoadFn } from '../dataloader/dataloader'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const accepts = require('accepts')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fresh = require('fresh')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const qs = require('fast-querystring')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const busboy = require('busboy')

import { parseJsonBody, stripPrototype, parseCookies } from '@exisjs/rs'

export class ExisRequest<
  TBody = unknown,
  TQuery = Record<string, string>,
  TParams = Record<string, string>,
> {
  public params!: TParams
  public body!: TBody
  public files: import('../types').ExisFile[] = []

  public rawBody?: string
  public user!: import('../types').ExisUser & Record<string, any>
  public log!: Logger
  public session?: Record<string, any> | any
  public requestId?: string
  public tenantId?: string

  public _dataloaderFns?: Map<
    string,
    {
      batchFn: BatchLoadFn<any, any>
      options?: import('../dataloader/dataloader').DataloaderOptions<any, any>
    }
  >
  private _dataloaderCache = new Map<string, Dataloader<any, any, any>>()
  public _diCache = new Map<any, any>()

  private _urlStr: string
  private _qIdx: number
  private _path?: string
  private _query?: Record<string, string>
  private _cookies?: Record<string, string>
  private _ips?: string[]
  private _ip?: string
  private _protocol?: string
  private _hostname?: string

  constructor(
    public raw: IncomingMessage,
    public res: ExisResponse,
    private trustProxy: boolean | number = false,
    private bodyLimit = 1048576 // 1MB
  ) {
    this._urlStr = raw.url ?? '/'
    this._qIdx = this._urlStr.indexOf('?')
  }

  public init(
    raw: IncomingMessage,
    res: ExisResponse,
    trustProxy: boolean | number = false,
    bodyLimit = 1048576 // 1MB
  ): this {
    this.raw = raw
    this.res = res
    this.trustProxy = trustProxy
    this.bodyLimit = bodyLimit

    this.params = undefined as any
    this.body = undefined as any
    this.files = []
    this.rawBody = undefined
    this.user = undefined as any
    this.log = undefined as any
    this.session = undefined
    this.requestId = undefined
    this.tenantId = undefined

    this._dataloaderFns = undefined
    this._dataloaderCache.clear()
    this._diCache.clear()

    this._urlStr = raw.url ?? '/'
    this._qIdx = this._urlStr.indexOf('?')
    this._path = undefined
    this._query = undefined
    this._cookies = undefined
    this._ips = undefined
    this._ip = undefined
    this._protocol = undefined
    this._hostname = undefined
    this._method = undefined

    return this
  }

  private _method?: string

  get method(): string {
    return this._method ?? this.raw.method ?? 'GET'
  }

  set method(val: string) {
    this._method = val
  }

  get headers(): import('node:http').IncomingHttpHeaders {
    return this.raw.headers
  }

  get path(): string {
    if (this._path !== undefined) return this._path
    this._path =
      this._qIdx === -1 ? this._urlStr : this._urlStr.slice(0, this._qIdx)
    return this._path
  }

  set path(val: string) {
    this._path = val
  }

  get query(): TQuery {
    if (this._query !== undefined) return this._query as unknown as TQuery
    if (this._qIdx === -1) {
      this._query = Object.create(null) as Record<string, string>
      return this._query as unknown as TQuery
    }
    this._query = qs.parse(this._urlStr.slice(this._qIdx + 1)) as Record<
      string,
      string
    >
    return this._query as unknown as TQuery
  }

  set query(val: Record<string, string>) {
    this._query = val
  }

  get cookies(): Record<string, string> {
    if (this._cookies !== undefined) return this._cookies
    const cookieHeader = this.raw.headers.cookie
    const parsed = cookieHeader ? parseCookies(cookieHeader) : {}
    this._cookies = parsed
    return parsed
  }

  set cookies(val: Record<string, string>) {
    this._cookies = val
  }

  /**
   * When "trust proxy" is set, trusted proxy addresses + client.
   *
   * For example if the value were "client, proxy1, proxy2"
   * you would receive the array `["client", "proxy1", "proxy2"]`
   * where "proxy2" is the furthest down-stream and "proxy1" and
   * "proxy2" were trusted.
   *
   * @return {string[]}
   * @public
   */
  get ips(): string[] {
    if (this._ips !== undefined) return this._ips
    this._resolveIps()
    return this._ips!
  }

  /**
   * Return the remote address from the trusted proxy.
   *
   * The is the remote address on the socket unless
   * "trust proxy" is set.
   *
   * @return {string}
   * @public
   */
  get ip(): string {
    if (this._ip !== undefined) return this._ip
    this._resolveIps()
    return this._ip!
  }

  private _resolveIps() {
    const xForwardedFor = this.raw.headers['x-forwarded-for']
    let ips: string[] = []
    if (xForwardedFor) {
      const raw = Array.isArray(xForwardedFor)
        ? xForwardedFor.join(',')
        : xForwardedFor
      ips = raw.split(',').map((ip) => ip.trim())
    }

    const remoteAddress = this.raw.socket?.remoteAddress ?? '127.0.0.1'

    if (this.trustProxy) {
      let trustedIps = ips
      if (typeof this.trustProxy === 'number' && this.trustProxy > 0) {
        trustedIps = ips.slice(-(this.trustProxy + 1))
      }
      this._ips = trustedIps
      this._ip = trustedIps.length > 0 ? trustedIps[0] : remoteAddress
    } else {
      this._ips = []
      this._ip = remoteAddress
    }
  }

  get protocol(): string {
    if (this._protocol !== undefined) return this._protocol
    const connection = this.raw.socket as import('node:net').Socket & {
      encrypted?: boolean
    }
    const isTls = connection?.encrypted || false
    let protocol = isTls ? 'https' : 'http'

    const xForwardedProto = this.raw.headers['x-forwarded-proto']
    if (this.trustProxy && xForwardedProto) {
      const rawProto = Array.isArray(xForwardedProto)
        ? xForwardedProto.join(',')
        : xForwardedProto
      protocol = rawProto.split(',')[0].trim()
    }
    this._protocol = protocol
    return this._protocol
  }

  get secure(): boolean {
    return this.protocol === 'https'
  }

  /**
   * Parse the "Host" header field to a hostname.
   *
   * When the "trust proxy" setting trusts the socket
   * address, the "X-Forwarded-Host" header field will
   * be trusted.
   *
   * @return {string}
   * @public
   */
  get hostname(): string {
    if (this._hostname !== undefined) return this._hostname
    let host = this.raw.headers['x-forwarded-host']
    if (!host || !this.trustProxy) {
      host = this.raw.headers.host || ''
    }
    if (Array.isArray(host)) host = host[0]

    // IPv6 can have colons, so look for port after bracket or last colon
    const offset = host[0] === '[' ? host.indexOf(']') + 1 : 0
    const index = host.indexOf(':', offset)
    this._hostname = index !== -1 ? host.substring(0, index) : host
    return this._hostname
  }

  /**
   * The original URL requested by the client.
   *
   * @return {string}
   * @public
   */
  get originalUrl(): string {
    return this._urlStr
  }

  /**
   * Return request header.
   *
   * The `Referrer` header field is special-cased,
   * both `Referrer` and `Referer` are interchangeable.
   *
   * Examples:
   *
   *     req.get('Content-Type');
   *     // => "text/plain"
   *
   *     req.get('content-type');
   *     // => "text/plain"
   *
   *     req.get('Something');
   *     // => undefined
   *
   * Aliased as `req.header()`.
   *
   * @param {string} header
   * @return {string | undefined}
   * @public
   */
  get(header: string): string | undefined {
    const val = this.raw.headers[header.toLowerCase()]
    if (Array.isArray(val)) return val[0]
    return val
  }

  /**
   * Return request header.
   *
   * Alias for `req.get()`.
   *
   * @param {string} name
   * @return {string | undefined}
   * @public
   */
  header(name: string): string | undefined {
    return this.get(name)
  }

  /**
   * Check if the incoming request contains the "Content-Type"
   * header field, and it contains the given mime `type`.
   *
   * Examples:
   *
   *      // With Content-Type: text/html; charset=utf-8
   *      req.is('html');
   *      req.is('text/html');
   *      req.is('text/*');
   *      // => true
   *
   *      // When Content-Type is application/json
   *      req.is('json');
   *      req.is('application/json');
   *      req.is('application/*');
   *      // => true
   *
   *      req.is('html');
   *      // => false
   *
   * @param {string} contentType
   * @return {boolean}
   * @public
   */
  is(contentType: string): boolean {
    const header = this.get('content-type')
    if (!header) return false
    return header.includes(contentType)
  }

  /**
   * Check if the given `type(s)` is acceptable, returning
   * the best match when true, otherwise `false`, in which
   * case you should respond with 406 "Not Acceptable".
   *
   * Examples:
   *
   *     // Accept: text/html
   *     req.accepts('html');
   *     // => "html"
   *
   *     // Accept: text/*, application/json
   *     req.accepts('html');
   *     // => "html"
   *
   * @param {string[]} types
   * @return {string | string[] | false}
   * @public
   */
  accepts(...types: string[]): string | string[] | false {
    const accept = accepts(this.raw)
    return accept.types(...types)
  }

  /**
   * Check if the given `lang`s are acceptable,
   * otherwise you should respond with 406 "Not Acceptable".
   *
   * @param {string[]} languages
   * @return {string | string[] | false}
   * @public
   */
  acceptsLanguages(...languages: string[]): string | string[] | false {
    const accept = accepts(this.raw)
    return accept.languages(...languages)
  }

  /**
   * Check if the request is fresh, aka
   * Last-Modified or the ETag
   * still match.
   *
   * @return {boolean}
   * @public
   */
  get fresh(): boolean {
    const method = this.method
    const s = this.res.statusCode
    if (method !== 'GET' && method !== 'HEAD') return false
    if ((s >= 200 && s < 300) || s === 304) {
      return fresh(this.headers, {
        etag: this.res.getHeader('ETag'),
        'last-modified': this.res.getHeader('Last-Modified'),
      })
    }
    return false
  }

  /**
   * Check if the request is stale, aka
   * "Last-Modified" and / or the "ETag" for the
   * resource has changed.
   *
   * @return {boolean}
   * @public
   */
  get stale(): boolean {
    return !this.fresh
  }

  async text(): Promise<string> {
    if (this.rawBody !== undefined) return this.rawBody
    await this._parseBody()
    return this.rawBody!
  }

  dataloader<K, V, C = K>(name: string): Dataloader<K, V, C> {
    if (this._dataloaderCache.has(name)) {
      return this._dataloaderCache.get(name)! as Dataloader<K, V, C>
    }
    if (!this._dataloaderFns || !this._dataloaderFns.has(name)) {
      throw new Error(`Dataloader '${name}' is not registered on the App`)
    }
    const def = this._dataloaderFns.get(name)!
    const dl = new Dataloader<K, V, C>(def.batchFn, def.options)
    this._dataloaderCache.set(name, dl)
    return dl
  }

  async json<T = unknown>(): Promise<T> {
    if (this.body !== undefined) return this.body as unknown as T
    if (!this.rawBody) await this.text()
    if (!this.rawBody) {
      this.body = {} as unknown as TBody
      return this.body as unknown as T
    }
    try {
      this.body = parseJsonBody(this.rawBody)
      return this.body as unknown as T
    } catch {
      throw HttpError.badRequest('Invalid JSON body')
    }
  }

  async formData(): Promise<{
    fields: Record<string, string>
    files: Record<string, any>
  }> {
    const contentType = this.get('content-type') ?? ''

    if (contentType.includes('application/x-www-form-urlencoded')) {
      if (!this.rawBody) await this.text()
      const fields = qs.parse(this.rawBody || '')
      this.body = stripPrototype(fields) as unknown as TBody
      return {
        fields: this.body as unknown as Record<string, string>,
        files: {},
      }
    }

    if (contentType.includes('multipart/form-data')) {
      if (!contentType.includes('boundary=')) {
        throw HttpError.badRequest(
          'Missing multipart boundary. Ensure you are not manually setting the Content-Type header in your client (e.g. Axios) so that the browser can auto-attach the boundary string.'
        )
      }

      return new Promise((resolve, reject) => {
        const fields: Record<string, string> = {}

        try {
          const bb = busboy({
            headers: this.raw.headers,
            limits: { fileSize: this.bodyLimit },
          })

          bb.on('field', (name: string, val: string) => {
            fields[name] = val
          })

          bb.on(
            'file',
            (
              name: string,
              fileStream: import('node:stream').Readable,
              info: any
            ) => {
              const chunks: Buffer[] = []
              let size = 0
              fileStream.on('data', (data: Buffer) => {
                chunks.push(data)
                size += data.length
              })
              fileStream.on('end', () => {
                const data = Buffer.concat(chunks)
                const filename = info.filename || 'unknown'

                this.files.push({
                  fieldname: name,
                  filename: filename,
                  mimetype: info.mimeType || 'application/octet-stream',
                  data,
                  size,
                  saveToDisk: async (destDir: string) => {
                    const fs = await import('node:fs/promises')
                    const path = await import('node:path')

                    // Create dir if not exists
                    await fs.mkdir(destDir, { recursive: true })

                    // Generate unique filename
                    const ext = path.extname(filename)
                    const uniqueSuffix =
                      Date.now() + '-' + Math.round(Math.random() * 1e9)
                    const finalName = `${name}-${uniqueSuffix}${ext}`
                    const destPath = path.join(destDir, finalName)

                    await fs.writeFile(destPath, data)
                    return destPath
                  },
                })
              })
            }
          )

          bb.on('finish', () => {
            this.body = fields as unknown as TBody
            resolve({
              fields,
              files: this.files as unknown as Record<string, any>,
            })
          })

          bb.on('error', reject)

          this.raw.pipe(bb)
        } catch (err: any) {
          reject(
            HttpError.badRequest(
              err.message || 'Failed to parse multipart data'
            )
          )
        }
      })
    }

    throw HttpError.badRequest('Unsupported form data type')
  }

  typedParams<T>(): T {
    return this.params as unknown as T
  }

  typedQuery<T>(): T {
    return this.query as unknown as T
  }

  typedBody<T>(): T {
    return this.body as unknown as T
  }

  private _parseBody(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false

      const done = (err?: Error) => {
        if (settled) return
        settled = true
        this.raw.removeAllListeners('data')
        this.raw.removeAllListeners('end')
        this.raw.removeAllListeners('error')
        this.raw.removeAllListeners('aborted')
        this.raw.removeAllListeners('close')

        if (err) reject(err)
        else resolve()
      }

      const contentType = this.get('content-type') ?? ''
      if (
        ['GET', 'HEAD', 'OPTIONS'].includes(this.method) ||
        contentType.includes('multipart/form-data')
      ) {
        done()
        return
      }

      const contentLengthStr = this.get('content-length')
      if (contentLengthStr) {
        const contentLength = parseInt(contentLengthStr, 10)
        if (!isNaN(contentLength) && contentLength > this.bodyLimit) {
          done(
            new Error(`Request body exceeds limit of ${this.bodyLimit} bytes`)
          )
          return
        }
      }

      const chunks: Buffer[] = []
      let size = 0

      this.raw.on('data', (chunk: Buffer) => {
        if (settled) return
        size += chunk.length
        if (size > this.bodyLimit) {
          this.raw.destroy()
          done(
            new Error(`Request body exceeds limit of ${this.bodyLimit} bytes`)
          )
          return
        }
        chunks.push(chunk)
      })

      this.raw.on('error', done)
      this.raw.on('aborted', () => done(new Error('Request aborted by client')))
      this.raw.on('close', () => {
        if (!settled && !this.raw.complete)
          done(new Error('Request closed prematurely'))
      })

      this.raw.on('end', () => {
        if (settled) return
        this.rawBody = Buffer.concat(chunks).toString('utf8')
        done()
      })
    })
  }

  async streamUpload(destDir: string): Promise<{
    fields: Record<string, string>
    files: {
      fieldname: string
      filename: string
      mimetype: string
      destPath: string
      size: number
    }[]
  }> {
    const contentType = this.get('content-type') ?? ''
    if (!contentType.includes('multipart/form-data')) {
      throw HttpError.badRequest('streamUpload requires multipart/form-data')
    }
    if (!contentType.includes('boundary=')) {
      throw HttpError.badRequest('Missing multipart boundary.')
    }

    const fs = await import('node:fs')
    const path = await import('node:path')
    await fs.promises.mkdir(destDir, { recursive: true })

    return new Promise((resolve, reject) => {
      const fields: Record<string, string> = {}
      const streamedFiles: {
        fieldname: string
        filename: string
        mimetype: string
        destPath: string
        size: number
      }[] = []

      try {
        const bb = busboy({ headers: this.raw.headers })

        bb.on('field', (name: string, val: string) => {
          fields[name] = val
        })

        bb.on(
          'file',
          (
            name: string,
            fileStream: import('node:stream').Readable,
            info: any
          ) => {
            const filename = info.filename || 'unknown'
            const ext = path.extname(filename)
            const uniqueSuffix =
              Date.now() + '-' + Math.round(Math.random() * 1e9)
            const finalName = `${name}-${uniqueSuffix}${ext}`
            const destPath = path.join(destDir, finalName)

            const writeStream = fs.createWriteStream(destPath)
            let size = 0

            fileStream.on('data', (data: Buffer) => {
              size += data.length
            })

            fileStream.pipe(writeStream)

            fileStream.on('end', () => {
              streamedFiles.push({
                fieldname: name,
                filename,
                mimetype: info.mimeType || 'application/octet-stream',
                destPath,
                size,
              })
            })
          }
        )

        bb.on('finish', () => {
          this.body = stripPrototype(fields) as unknown as TBody
          resolve({
            fields: this.body as unknown as Record<string, string>,
            files: streamedFiles,
          })
        })

        bb.on('error', reject)

        if (typeof this.raw.pipe === 'function') {
          this.raw.pipe(bb)
        } else {
          this.raw.on('data', (chunk: any) => bb.write(chunk))
          this.raw.on('end', () => bb.end())
        }
      } catch (err: any) {
        reject(
          HttpError.badRequest(err.message || 'Failed to stream multipart data')
        )
      }
    })
  }
}
