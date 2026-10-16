import { IncomingMessage } from 'node:http'
import type { Logger } from '../types'
import type { ExisResponse } from './response'
import { HttpError } from '../error/errors'
import { secureJsonParse, stripPrototype } from './helpers/json'
import { parseCookies } from './helpers/cookie'
import { evaluatePreconditions, toHttpTime } from './helpers/conditional'
import {
  resolveIps,
  resolveProtocol,
  resolveHostname,
  parseRawBody,
  parseMultipartFormData,
  streamMultipartUpload,
} from './helpers'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const accepts = require('accepts')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const qs = require('fast-querystring')

export class ExisRequest<
  TBody = unknown,
  TQuery = Record<string, string>,
  TParams = Record<string, string>,
> {
  public params!: TParams
  public body!: TBody
  public files: import('../types').ExisFile[] = []
  private _file?: import('../types').ExisFile

  get file(): import('../types').ExisFile | undefined {
    return this._file || this.files?.[0]
  }

  set file(val: import('../types').ExisFile | undefined) {
    this._file = val
  }

  // The body as received; the text form is decoded from it on first use
  private _rawBuffer?: Buffer
  private _rawText?: string

  /** The request body as UTF-8 text, once it has been read. */
  get rawBody(): string | undefined {
    if (this._rawText === undefined && this._rawBuffer !== undefined) {
      this._rawText = this._rawBuffer.toString('utf8')
    }
    return this._rawText
  }

  set rawBody(text: string | undefined) {
    this._rawText = text
    this._rawBuffer = undefined
  }
  public user!: import('../types').ExisUser & Record<string, any>
  private _baseLog?: Logger
  private _log?: Logger

  /**
   * Logger for this request. Every line it writes carries `requestId`, so a
   * request can be followed across log lines. Created on first use.
   */
  get log(): Logger {
    if (this._log !== undefined) return this._log
    const base = this._baseLog as any
    if (base && this.requestId && typeof base.child === 'function') {
      this._log = base.child({ requestId: this.requestId })
      return this._log!
    }
    return base
  }

  set log(logger: Logger) {
    this._baseLog = logger
    this._log = undefined
  }
  public session?: Record<string, any> | any
  public requestId?: string
  public tenantId?: string
  private _signal?: AbortSignal
  private _abortController?: AbortController

  public get signal(): AbortSignal {
    if (!this._abortController) {
      this._abortController = new AbortController()
      this._signal = this._abortController.signal
      if (!this._onClose) {
        this._onClose = () => {
          if (!this.res.raw.writableEnded && !this.res.headersSent) {
            if (
              this._abortController &&
              !this._abortController.signal.aborted
            ) {
              this._abortController.abort()
            }
          }
        }
      }
      if (typeof this.raw?.once === 'function') {
        this.raw.once('close', this._onClose!)
      } else if (typeof this.raw?.on === 'function') {
        this.raw.on('close', this._onClose!)
      }
    }
    return this._signal!
  }

  public set signal(val: AbortSignal) {
    this._signal = val
  }

  // Created on first use: most requests never touch request-scoped DI
  private _diCacheMap?: Map<any, any>
  public get _diCache(): Map<any, any> {
    return this._diCacheMap || (this._diCacheMap = new Map())
  }

  private _urlStr: string
  private _qIdx: number
  private _path?: string
  private _query?: Record<string, string>
  private _cookies?: Record<string, string>
  private _ips?: string[]
  private _ip?: string
  private _protocol?: string
  private _hostname?: string
  private _method?: string

  private _onClose?: () => void

  constructor(
    public raw: IncomingMessage,
    public res: ExisResponse,
    private trustProxy: boolean | number = false,
    private bodyLimit = 10485760 // 10MB
  ) {
    this._urlStr = raw.url ?? '/'
    this._qIdx = this._urlStr.indexOf('?')
  }

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
    const rawPath =
      this._qIdx === -1 ? this._urlStr : this._urlStr.slice(0, this._qIdx)
    // Fast path: skip regex if no consecutive slashes (99.9% of real traffic)
    this._path =
      rawPath.indexOf('//') === -1 ? rawPath : rawPath.replace(/\/+/g, '/')
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

  get ips(): string[] {
    if (this._ips !== undefined) return this._ips
    const res = resolveIps(this.raw, this.trustProxy)
    this._ips = res.ips
    this._ip = res.ip
    return this._ips
  }

  get ip(): string {
    if (this._ip !== undefined) return this._ip
    const res = resolveIps(this.raw, this.trustProxy)
    this._ips = res.ips
    this._ip = res.ip
    return this._ip
  }

  get protocol(): string {
    if (this._protocol !== undefined) return this._protocol
    this._protocol = resolveProtocol(this.raw, this.trustProxy)
    return this._protocol
  }

  get secure(): boolean {
    return this.protocol === 'https'
  }

  get hostname(): string {
    if (this._hostname !== undefined) return this._hostname
    this._hostname = resolveHostname(this.raw, this.trustProxy)
    return this._hostname
  }

  get originalUrl(): string {
    return this._urlStr
  }

  get(header: string): string | undefined {
    const val = this.raw.headers[header.toLowerCase()]
    if (Array.isArray(val)) return val[0]
    return val
  }

  header(name: string): string | undefined {
    return this.get(name)
  }

  is(contentType: string): boolean {
    const header = this.get('content-type')
    if (!header) return false
    return header.includes(contentType)
  }

  accepts(...types: string[]): string | string[] | false {
    const accept = accepts(this.raw)
    return accept.types(...types)
  }

  acceptsLanguages(...languages: string[]): string | string[] | false {
    const accept = accepts(this.raw)
    return accept.languages(...languages)
  }

  /**
   * True when the client's cached copy is current: a GET/HEAD whose
   * conditional headers match the response's `ETag` / `Last-Modified`
   * (so a 304 would be the right answer).
   */
  get fresh(): boolean {
    const method = this.method
    const s = this.res.statusCode
    if (method !== 'GET' && method !== 'HEAD') return false
    if (!((s >= 200 && s < 300) || s === 304)) return false
    const etag = this.res.getHeader('ETag')
    const lastModified = this.res.getHeader('Last-Modified')
    if (etag === undefined && lastModified === undefined) return false
    return (
      evaluatePreconditions(method, this.headers, {
        etag: etag === undefined ? undefined : String(etag),
        lastModified:
          lastModified === undefined
            ? undefined
            : toHttpTime(String(lastModified)),
      }) === 'not-modified'
    )
  }

  get stale(): boolean {
    return !this.fresh
  }

  async text(): Promise<string> {
    if (this.rawBody === undefined) await this._parseBody()
    return this.rawBody ?? ''
  }

  /** The request body as received, byte for byte (binary-safe). */
  async buffer(): Promise<Buffer> {
    if (this._rawBuffer !== undefined) return this._rawBuffer
    // A body set as text (by middleware or a test)
    if (this._rawText !== undefined) return Buffer.from(this._rawText, 'utf8')
    await this._parseBody()
    return this._rawBuffer!
  }

  async json<T = unknown>(): Promise<T> {
    if (this.body !== undefined) return this.body as unknown as T
    if (!this.rawBody) await this.text()
    if (!this.rawBody) {
      this.body = {} as unknown as TBody
      return this.body as unknown as T
    }
    try {
      this.body = secureJsonParse(this.rawBody)
      return this.body as unknown as T
    } catch {
      throw new HttpError('Invalid JSON body', 400, 'INVALID_JSON')
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

      const res = await parseMultipartFormData(
        this.raw,
        this.bodyLimit,
        this.files
      )
      this.body = res.fields as unknown as TBody
      return res
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

  setTimeout(ms: number): this {
    if (typeof (this as any)._timeoutSetter === 'function') {
      ;(this as any)._timeoutSetter(ms)
    } else if (typeof (this.raw as any).setTimeout === 'function') {
      ;(this.raw as any).setTimeout(ms)
    }
    return this
  }

  clearTimeout(): this {
    if (typeof (this as any)._timeoutClearer === 'function') {
      ;(this as any)._timeoutClearer()
    } else if (typeof (this.raw as any).clearTimeout === 'function') {
      ;(this.raw as any).clearTimeout()
    }
    return this
  }

  // One read of the stream, shared by concurrent text() / buffer() / json()
  private _bodyRead?: Promise<void>

  private _parseBody(): Promise<void> {
    return (this._bodyRead ??= parseRawBody(
      this.raw,
      this.bodyLimit,
      this.get('content-type') ?? '',
      this.method
    ).then((buf) => {
      this._rawBuffer = buf
      this._rawText = undefined
    }))
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

    const res = await streamMultipartUpload(this.raw, destDir, this.bodyLimit)
    this.body = res.fields as unknown as TBody
    return res
  }
}
