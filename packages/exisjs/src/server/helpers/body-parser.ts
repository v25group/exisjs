import type { IncomingMessage } from 'node:http'
import { HttpError } from '../../error/errors'
import { stripPrototype } from './json'
import type { ExisFile } from '../../types'
import { safeUploadPath, DEFAULT_UPLOAD_LIMITS } from './upload-name'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const busboy = require('busboy')

export async function parseRawBody(
  raw: IncomingMessage,
  bodyLimit: number,
  contentType: string,
  method: string
): Promise<string> {
  if (
    ['GET', 'HEAD', 'OPTIONS'].includes(method) ||
    contentType.includes('multipart/form-data')
  ) {
    return ''
  }

  if (typeof (raw as any).readBody === 'function') {
    const buf = await (raw as any).readBody(bodyLimit)
    return buf ? buf.toString('utf8') : ''
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const chunks: Buffer[] = []
    let size = 0

    const onData = (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size > bodyLimit) {
        raw.destroy?.()
        done(
          HttpError.payloadTooLarge(
            `Request body exceeds limit of ${bodyLimit} bytes. Configure 'bodyLimit' in 'exis.config.ts' to allow larger payloads.`
          )
        )
        return
      }
      chunks.push(chunk)
    }

    const onError = (err: any) => done(err)
    const onAborted = () => done(new Error('Request aborted by client'))
    const onClose = () => {
      const isComplete = Boolean(
        (raw as any).complete || (raw as any).readableEnded
      )
      if (!settled && !isComplete) {
        done(new Error('Request closed prematurely'))
      }
    }
    const onEnd = () => {
      if (settled) return
      const rawBody = Buffer.concat(chunks).toString('utf8')
      done(undefined, rawBody)
    }

    const cleanup = () => {
      raw.removeListener('data', onData)
      raw.removeListener('error', onError)
      raw.removeListener('aborted', onAborted)
      raw.removeListener('close', onClose)
      raw.removeListener('end', onEnd)
    }

    const done = (err?: Error, result?: string) => {
      if (settled) return
      settled = true
      cleanup()
      if (err) reject(err)
      else resolve(result ?? '')
    }

    const contentLengthStr = raw.headers['content-length']
    if (contentLengthStr) {
      const contentLength = parseInt(contentLengthStr, 10)
      if (!isNaN(contentLength) && contentLength > bodyLimit) {
        done(
          HttpError.payloadTooLarge(
            `Request body exceeds limit of ${bodyLimit} bytes. Configure 'bodyLimit' in 'exis.config.ts' to allow larger payloads.`
          )
        )
        return
      }
    }

    raw.on('data', onData)
    raw.on('error', onError)
    raw.on('aborted', onAborted)
    raw.on('close', onClose)
    raw.on('end', onEnd)
  })
}

export function parseMultipartFormData(
  raw: IncomingMessage,
  bodyLimit: number,
  filesContainer: ExisFile[]
): Promise<{ fields: Record<string, string>; files: Record<string, any> }> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {}

    try {
      const bb = busboy({
        headers: raw.headers,
        limits: { ...DEFAULT_UPLOAD_LIMITS, fileSize: bodyLimit },
      })

      // Files are buffered in memory, so cap the combined size as well as
      // each file; otherwise N files could each use the full bodyLimit.
      let totalSize = 0
      let failed = false
      const fail = (err: Error) => {
        if (failed) return
        failed = true
        cleanup()
        try {
          raw.unpipe?.(bb)
          raw.resume?.()
        } catch {
          /* noop */
        }
        reject(err)
      }
      const tooLarge = (what: string) =>
        fail(
          HttpError.payloadTooLarge(
            `${what} exceeds the limit of ${bodyLimit} bytes. Configure 'bodyLimit' in 'exis.config.ts' to allow larger payloads.`
          )
        )
      bb.on('filesLimit', () =>
        fail(HttpError.payloadTooLarge('Too many files in multipart body'))
      )
      bb.on('fieldsLimit', () =>
        fail(HttpError.payloadTooLarge('Too many fields in multipart body'))
      )
      bb.on('partsLimit', () =>
        fail(HttpError.payloadTooLarge('Too many parts in multipart body'))
      )

      const cleanup = () => {
        raw.removeListener('close', onRawClose)
        raw.removeListener('aborted', onRawClose)
      }

      const onRawClose = () => {
        const isComplete = Boolean(
          (raw as any).complete || (raw as any).readableEnded
        )
        if (!isComplete) {
          try {
            ;(bb as any).destroy?.()
          } catch {
            /* noop */
          }
          cleanup()
          reject(
            HttpError.badRequest(
              'Client disconnected prematurely during multipart upload'
            )
          )
        }
      }

      raw.once('close', onRawClose)
      raw.once('aborted', onRawClose)

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
          fileStream.on('limit', () => tooLarge('Uploaded file'))
          fileStream.on('data', (data: Buffer) => {
            if (failed) return
            size += data.length
            totalSize += data.length
            if (totalSize > bodyLimit) {
              tooLarge('Multipart body')
              return
            }
            chunks.push(data)
          })
          fileStream.on('end', () => {
            if (failed) return
            const data = Buffer.concat(chunks)
            const filename = info.filename || 'unknown'

            filesContainer.push({
              fieldname: name,
              filename: filename,
              mimetype: info.mimeType || 'application/octet-stream',
              data,
              size,
              saveToDisk: async (destDir: string) => {
                const fs = await import('node:fs/promises')

                await fs.mkdir(destDir, { recursive: true })

                const destPath = safeUploadPath(destDir, name, filename)
                await fs.writeFile(destPath, data)
                return destPath
              },
            })
          })
        }
      )

      bb.on('finish', () => {
        if (failed) return
        cleanup()
        resolve({
          fields: stripPrototype(fields),
          files: filesContainer as unknown as Record<string, any>,
        })
      })

      bb.on('error', (err: any) => fail(err))

      raw.pipe(bb)
    } catch (err: any) {
      reject(
        HttpError.badRequest(err.message || 'Failed to parse multipart data')
      )
    }
  })
}

export async function streamMultipartUpload(
  raw: IncomingMessage,
  destDir: string,
  bodyLimit = 10 * 1024 * 1024
): Promise<{
  fields: Record<string, string>
  files: {
    fieldname: string
    filename: string
    mimetype: string
    destPath: string
    size: number
  }[]
}> {
  const fs = await import('node:fs')
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
    // Resolve only after every file is flushed to disk, not on busboy finish
    const pendingWrites: Promise<void>[] = []
    const written: string[] = []
    let totalSize = 0
    let failed = false

    const fail = (err: Error) => {
      if (failed) return
      failed = true
      try {
        raw.unpipe?.(bb)
        raw.resume?.()
      } catch {
        /* noop */
      }
      // Remove partial files so a rejected upload leaves nothing behind
      for (const p of written) fs.promises.unlink(p).catch(() => undefined)
      reject(err)
    }
    const tooLarge = (what: string) =>
      fail(
        HttpError.payloadTooLarge(
          `${what} exceeds the limit of ${bodyLimit} bytes. Configure 'bodyLimit' in 'exis.config.ts' to allow larger uploads.`
        )
      )

    let bb: any
    try {
      bb = busboy({
        headers: raw.headers,
        limits: { ...DEFAULT_UPLOAD_LIMITS, fileSize: bodyLimit },
      })
    } catch (err: any) {
      reject(
        HttpError.badRequest(err.message || 'Failed to stream multipart data')
      )
      return
    }

    bb.on('field', (name: string, val: string) => {
      fields[name] = val
    })
    bb.on('filesLimit', () =>
      fail(HttpError.payloadTooLarge('Too many files in multipart body'))
    )
    bb.on('fieldsLimit', () =>
      fail(HttpError.payloadTooLarge('Too many fields in multipart body'))
    )
    bb.on('partsLimit', () =>
      fail(HttpError.payloadTooLarge('Too many parts in multipart body'))
    )

    bb.on(
      'file',
      (name: string, fileStream: import('node:stream').Readable, info: any) => {
        if (failed) {
          fileStream.resume()
          return
        }
        const filename = info.filename || 'unknown'
        let destPath: string
        try {
          destPath = safeUploadPath(destDir, name, filename)
        } catch (err: any) {
          fileStream.resume()
          fail(err)
          return
        }
        written.push(destPath)

        const writeStream = fs.createWriteStream(destPath)
        let size = 0

        fileStream.on('limit', () => tooLarge('Uploaded file'))
        fileStream.on('data', (data: Buffer) => {
          size += data.length
          totalSize += data.length
          if (totalSize > bodyLimit) tooLarge('Multipart body')
        })

        pendingWrites.push(
          new Promise<void>((done, failWrite) => {
            writeStream.on('finish', () => {
              streamedFiles.push({
                fieldname: name,
                filename,
                mimetype: info.mimeType || 'application/octet-stream',
                destPath,
                size,
              })
              done()
            })
            writeStream.on('error', failWrite)
            fileStream.on('error', failWrite)
          })
        )

        fileStream.pipe(writeStream)
      }
    )

    bb.on('finish', () => {
      Promise.all(pendingWrites).then(
        () => {
          if (failed) return
          resolve({ fields: stripPrototype(fields), files: streamedFiles })
        },
        (err) => fail(err)
      )
    })

    bb.on('error', (err: any) => fail(err))

    if (typeof raw.pipe === 'function') {
      raw.pipe(bb)
    } else {
      ;(raw as any).on('data', (chunk: any) => bb.write(chunk))
      ;(raw as any).on('end', () => bb.end())
    }
  })
}
