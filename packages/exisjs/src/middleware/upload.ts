import type {
  Handler,
  Request,
  Response,
  NextFunction,
  ExisFile,
} from '../types'
import { HttpError } from '../error/errors'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const busboy = require('busboy')
import * as path from 'node:path'
import * as fs from 'node:fs/promises'

export interface FileUploadLimits {
  fileSize?: number
  files?: number
  fields?: number
  parts?: number
}

export interface FileUploadOptions {
  /** Single field name to match */
  field?: string
  /** Multiple fields configuration */
  fields?: { name: string; maxCount?: number }[]
  /** Maximum number of files to accept */
  maxCount?: number
  /** Disk directory to automatically save uploaded files to */
  dest?: string
  /** Destination mode: 'memory' | 'disk' | 'stream' or directory path */
  destination?: 'memory' | 'disk' | 'stream' | string
  /** Storage mode: 'memory' | 'disk' */
  storage?: 'memory' | 'disk'
  /** Maximum file size as number (bytes) or string (e.g. '10MB', '500KB') */
  maxSize?: number | string
  /** Size and file count limits */
  limits?: FileUploadLimits
  /** Allowed MIME types (e.g. ['image/jpeg', 'image/png'] or ['image/*']) */
  allowedMimeTypes?: string[]
  /** Alias for allowedMimeTypes */
  mimeTypes?: string[]
  /** Custom filter predicate to allow or reject a file */
  fileFilter?: (file: {
    fieldname: string
    filename: string
    mimetype: string
  }) => boolean | Promise<boolean>
}

export function parseSizeToBytes(
  size: string | number | undefined
): number | undefined {
  if (typeof size === 'number') return size
  if (!size || typeof size !== 'string') return undefined
  const match = size.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i)
  if (!match) return undefined
  const val = parseFloat(match[1])
  const unit = (match[2] || 'b').toLowerCase()
  switch (unit) {
    case 'kb':
      return Math.round(val * 1024)
    case 'mb':
      return Math.round(val * 1024 * 1024)
    case 'gb':
      return Math.round(val * 1024 * 1024 * 1024)
    case 'tb':
      return Math.round(val * 1024 * 1024 * 1024 * 1024)
    default:
      return Math.round(val)
  }
}

function matchesMime(mimetype: string, pattern: string): boolean {
  if (pattern === '*' || pattern === '*/*') return true
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, pattern.indexOf('/*'))
    return mimetype.startsWith(prefix + '/')
  }
  return mimetype.toLowerCase() === pattern.toLowerCase()
}

/**
 * Native first-party multipart file upload middleware.
 * Supports memory buffering, disk saving, MIME validation, and Multer-like ergonomics.
 *
 * Examples:
 * ```ts
 * route.post('/avatar', fileUpload.single('avatar'), (req, res) => {
 *   res.json({ file: req.file })
 * })
 *
 * route.post('/photos', fileUpload.array('photos', 5), (req, res) => {
 *   res.json({ files: req.files })
 * })
 * ```
 */
export function fileUpload(rawOptions: FileUploadOptions = {}): Handler {
  const options: FileUploadOptions = { ...rawOptions }
  const parsedSize = parseSizeToBytes(options.maxSize)
  if (parsedSize && (!options.limits || !options.limits.fileSize)) {
    options.limits = {
      ...(options.limits || {}),
      fileSize: parsedSize,
    }
  }
  if (
    options.destination &&
    !options.dest &&
    options.destination !== 'memory' &&
    options.destination !== 'stream'
  ) {
    options.dest = options.destination
  }
  if (options.destination === 'memory' || options.storage === 'memory') {
    delete options.dest
  }
  if (options.mimeTypes && !options.allowedMimeTypes) {
    options.allowedMimeTypes = options.mimeTypes
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const contentType = req.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return next()
    }

    if (!contentType.includes('boundary=')) {
      return next(
        HttpError.badRequest(
          'Missing multipart boundary. Ensure you are not manually overriding the Content-Type header in your client.'
        )
      )
    }

    return new Promise<void>((resolve) => {
      let settled = false
      const done = (err?: any) => {
        if (settled) return
        settled = true
        if (err) {
          next(err)
        } else {
          next()
        }
        resolve()
      }

      const bbLimits: Record<string, number> = {}
      if (options.limits?.fileSize) bbLimits.fileSize = options.limits.fileSize
      if (options.limits?.files) bbLimits.files = options.limits.files
      if (options.maxCount) bbLimits.files = options.maxCount
      if (options.limits?.fields) bbLimits.fields = options.limits.fields
      if (options.limits?.parts) bbLimits.parts = options.limits.parts

      const fieldsMap: Record<string, string> = {}
      const collectedFiles: ExisFile[] = []
      let hasLimitError = false
      let limitErrorMessage = ''
      let filterError: Error | null = null

      try {
        const bb = busboy({
          headers: req.raw.headers,
          limits: Object.keys(bbLimits).length > 0 ? bbLimits : undefined,
        })

        bb.on('field', (name: string, val: string) => {
          fieldsMap[name] = val
        })

        bb.on('filesLimit', () => {
          hasLimitError = true
          limitErrorMessage = `Exceeded maximum file upload limit`
        })

        bb.on(
          'file',
          (
            name: string,
            fileStream: import('node:stream').Readable,
            info: any
          ) => {
            const filename = info.filename || 'unknown'
            const mimetype = info.mimeType || 'application/octet-stream'

            // Verify field restriction if single field configured
            if (options.field && name !== options.field) {
              fileStream.resume() // Drain stream
              return
            }

            // Verify field restriction if fields array configured
            if (options.fields) {
              const fieldConfig = options.fields.find((f) => f.name === name)
              if (!fieldConfig) {
                fileStream.resume() // Drain
                return
              }
              if (fieldConfig.maxCount) {
                const currentCount = collectedFiles.filter(
                  (f) => f.fieldname === name
                ).length
                if (currentCount >= fieldConfig.maxCount) {
                  fileStream.resume()
                  hasLimitError = true
                  limitErrorMessage = `Field '${name}' exceeded maxCount of ${fieldConfig.maxCount}`
                  return
                }
              }
            }

            // Validate MIME type
            if (
              options.allowedMimeTypes &&
              options.allowedMimeTypes.length > 0
            ) {
              const isAllowed = options.allowedMimeTypes.some((pattern) =>
                matchesMime(mimetype, pattern)
              )
              if (!isAllowed) {
                fileStream.resume()
                filterError = HttpError.badRequest(
                  `File '${filename}' has invalid MIME type '${mimetype}'. Allowed: ${options.allowedMimeTypes.join(', ')}`
                )
                return
              }
            }

            // Validate custom filter
            if (options.fileFilter) {
              try {
                const allowed = options.fileFilter({
                  fieldname: name,
                  filename,
                  mimetype,
                })
                if (!allowed) {
                  fileStream.resume()
                  return
                }
              } catch (err: any) {
                fileStream.resume()
                filterError =
                  err instanceof Error ? err : new Error(String(err))
                return
              }
            }

            let fileTruncated = false
            fileStream.on('limit', () => {
              fileTruncated = true
              hasLimitError = true
              const limit = options.limits?.fileSize
              limitErrorMessage = limit
                ? `File '${filename}' exceeds size limit of ${limit} bytes`
                : `File '${filename}' exceeds size limit`
            })

            const chunks: Buffer[] = []
            let size = 0

            fileStream.on('data', (chunk: Buffer) => {
              chunks.push(chunk)
              size += chunk.length
            })

            fileStream.on('end', () => {
              if (fileTruncated) return

              const data = Buffer.concat(chunks)
              const fileItem: ExisFile = {
                fieldname: name,
                filename,
                mimetype,
                data,
                buffer: data, // Multer compatibility
                size,
                saveToDisk: async (destDir: string) => {
                  await fs.mkdir(destDir, { recursive: true })
                  const ext = path.extname(filename)
                  const uniqueSuffix =
                    Date.now() + '-' + Math.round(Math.random() * 1e9)
                  const finalName = `${name}-${uniqueSuffix}${ext}`
                  const destPath = path.join(destDir, finalName)
                  await fs.writeFile(destPath, data)
                  fileItem.path = destPath
                  return destPath
                },
              }

              collectedFiles.push(fileItem)
            })
          }
        )

        bb.on('finish', async () => {
          if (filterError) {
            return done(filterError)
          }

          if (hasLimitError) {
            return done(HttpError.payloadTooLarge(limitErrorMessage))
          }

          // Auto-save to destination if dest option is set
          if (options.dest && collectedFiles.length > 0) {
            try {
              await fs.mkdir(options.dest, { recursive: true })
              for (const file of collectedFiles) {
                await file.saveToDisk(options.dest)
              }
            } catch (err) {
              return done(err)
            }
          }

          // Attach to request
          req.files = collectedFiles
          if (collectedFiles.length > 0) {
            if (options.field) {
              const matched = collectedFiles.find(
                (f) => f.fieldname === options.field
              )
              req.file = matched || collectedFiles[0]
            } else {
              req.file = collectedFiles[0]
            }
          }

          req.body = { ...((req.body as any) || {}), ...fieldsMap }
          done()
        })

        bb.on('error', (err: any) => {
          done(
            HttpError.badRequest(
              err.message || 'Failed to parse multipart upload'
            )
          )
        })

        req.raw.pipe(bb)
      } catch (err) {
        done(err)
      }
    })
  }
}

/** Accept a single file with the given field name */
fileUpload.single = function (
  fieldName: string,
  options?: Omit<FileUploadOptions, 'field'>
): Handler {
  return fileUpload({ ...options, field: fieldName, maxCount: 1 })
}

/** Accept multiple files under a single field name */
fileUpload.array = function (
  fieldName: string,
  maxCount?: number,
  options?: Omit<FileUploadOptions, 'field' | 'maxCount'>
): Handler {
  return fileUpload({ ...options, field: fieldName, maxCount })
}

/** Accept a mixture of files specified by fields array */
fileUpload.fields = function (
  fields: { name: string; maxCount?: number }[],
  options?: Omit<FileUploadOptions, 'fields'>
): Handler {
  return fileUpload({ ...options, fields })
}

/** Accept all files that arrive on the multipart request */
fileUpload.any = function (options?: FileUploadOptions): Handler {
  return fileUpload(options)
}

/** Accept only text fields, reject any uploaded files */
fileUpload.none = function (options?: FileUploadOptions): Handler {
  return fileUpload({
    ...options,
    fileFilter: () => {
      throw HttpError.badRequest(
        'Multipart files are not accepted on this route'
      )
    },
  })
}

/**
 * Seamlessly run any standard Express/Connect middleware (e.g. Multer, Passport)
 * in ExisJS with automatic synchronization of `req.file`, `req.files`, and `req.body`.
 *
 * Example:
 * ```ts
 * import multer from 'multer'
 * const upload = multer({ dest: './uploads' })
 *
 * route.post('/avatar', fromExpress(upload.single('avatar')), (req, res) => {
 *   res.json({ file: req.file })
 * })
 * ```
 */
export function fromExpress(
  expressMiddleware: (req: any, res: any, next: (err?: any) => void) => void
): Handler {
  return (req: Request, res: Response, next: NextFunction) => {
    const rawReq = req.raw as any
    const rawRes = res.raw as any

    rawReq.params = req.params
    rawReq.query = req.query
    rawReq.headers = req.headers

    expressMiddleware(rawReq, rawRes, (err?: any) => {
      if (err) return next(err)

      // Bridge Multer properties back onto ExisRequest
      if (rawReq.file) {
        req.file = rawReq.file
        if (!req.files) req.files = []
        if (!req.files.includes(rawReq.file)) req.files.push(rawReq.file)
      }
      if (rawReq.files) {
        if (Array.isArray(rawReq.files)) {
          req.files = rawReq.files
          if (rawReq.files.length > 0 && !req.file) {
            req.file = rawReq.files[0]
          }
        } else if (typeof rawReq.files === 'object') {
          // Flatten dictionary of arrays e.g. { avatar: [file], cover: [file] }
          const flatList: ExisFile[] = []
          for (const list of Object.values(rawReq.files)) {
            if (Array.isArray(list)) flatList.push(...list)
          }
          req.files = flatList
          if (flatList.length > 0 && !req.file) {
            req.file = flatList[0]
          }
        }
      }
      if (rawReq.body && typeof rawReq.body === 'object') {
        req.body = { ...((req.body as any) || {}), ...rawReq.body }
      }

      next()
    })
  }
}

/** Alias to fromExpress for Multer convenience */
fileUpload.fromExpress = fromExpress
