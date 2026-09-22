import type { IncomingMessage } from 'node:http'
import { HttpError } from '../../error/errors'
import { stripPrototype } from '@exisjs/rs'
import type { ExisFile } from '../../types'

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
        limits: { fileSize: bodyLimit },
      })

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
          fileStream.on('data', (data: Buffer) => {
            chunks.push(data)
            size += data.length
          })
          fileStream.on('end', () => {
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
                const path = await import('node:path')

                await fs.mkdir(destDir, { recursive: true })

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
        cleanup()
        resolve({
          fields,
          files: filesContainer as unknown as Record<string, any>,
        })
      })

      bb.on('error', (err: any) => {
        cleanup()
        reject(err)
      })

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
  destDir: string
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
      const bb = busboy({ headers: raw.headers })

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
        resolve({
          fields: stripPrototype(fields),
          files: streamedFiles,
        })
      })

      bb.on('error', reject)

      if (typeof raw.pipe === 'function') {
        raw.pipe(bb)
      } else {
        raw.on('data', (chunk: any) => bb.write(chunk))
        raw.on('end', () => bb.end())
      }
    } catch (err: any) {
      reject(
        HttpError.badRequest(err.message || 'Failed to stream multipart data')
      )
    }
  })
}
