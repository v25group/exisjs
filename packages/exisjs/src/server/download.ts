export interface DownloadOptions {
  /** Overrides the MIME type inferred from the filename */
  contentType?: string
  /** Extra response headers */
  headers?: Record<string, string>
  /**
   * For file paths: the directory the file must be inside. Paths resolving
   * outside it answer 404. Always set this when the path contains request data.
   */
  root?: string
}

/**
 * Returned from a handler to send content as an attachment.
 * Created with `download()` from `exisjs/response`.
 */
export class DownloadResponse {
  public readonly data:
    Buffer | NodeJS.ReadableStream | ReadableStream | AsyncIterable<any>

  constructor(
    data:
      | Buffer
      | string
      | NodeJS.ReadableStream
      | ReadableStream
      | AsyncIterable<any>,
    public readonly filename: string,
    public readonly options?: DownloadOptions
  ) {
    // A string here is content. It is turned into bytes up front so it can
    // never be mistaken for a file path by res.download()
    this.data = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  }
}
