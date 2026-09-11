import { fileUpload, fromExpress } from '../src/middleware/upload'
import { Router } from '../src/router/router'
import { Upload, UseUpload } from '../src/decorators/upload'
import { UploadedFile, UploadedFiles } from '../src/decorators/params'
import { MetadataEngine } from '../src/decorators/core/metadata'
import { METHOD_MIDDLEWARES } from '../src/decorators/constants'
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
} from './helpers'
import { describe, expect, it } from '../src/testing'
import { Readable } from 'node:stream'
import { Socket } from 'node:net'
import { ExisRequest } from '../src/server/request'

function createMultipartRequest(options: {
  boundary: string
  payload: string
  url?: string
}): ExisRequest {
  const socket = new Socket()
  const readable = new Readable({
    read() {
      this.push(Buffer.from(options.payload))
      this.push(null)
    },
  })
  Object.assign(readable, {
    method: 'POST',
    url: options.url || '/upload',
    headers: {
      'content-type': `multipart/form-data; boundary=${options.boundary}`,
    },
    socket,
  })
  return new ExisRequest(readable as any, createMockResponse() as any)
}

describe('fileUpload middleware', () => {
  const boundary = '---------------------------974767299852498929531610575'

  it('parses single file upload into req.file and fields into req.body', async () => {
    const payload =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="username"\r\n\r\n` +
      `john_doe\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="avatar"; filename="avatar.png"\r\n` +
      `Content-Type: image/png\r\n\r\n` +
      `fake-image-binary-data\r\n` +
      `--${boundary}--\r\n`

    const req = createMultipartRequest({ boundary, payload })
    const res = createMockResponse()
    const next = createMockNext()

    const handler = fileUpload.single('avatar')
    await handler(req as any, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.body).toBeDefined()
    expect((req.body as any).username).toBe('john_doe')
    expect(req.file).toBeDefined()
    expect(req.file?.fieldname).toBe('avatar')
    expect(req.file?.filename).toBe('avatar.png')
    expect(req.file?.mimetype).toBe('image/png')
    expect(req.file?.data.toString()).toBe('fake-image-binary-data')
    expect(req.file?.buffer?.toString()).toBe('fake-image-binary-data')
  })

  it('parses multiple files into req.files', async () => {
    const payload =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="photos"; filename="pic1.jpg"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n` +
      `image1\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="photos"; filename="pic2.jpg"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n` +
      `image2\r\n` +
      `--${boundary}--\r\n`

    const req = createMultipartRequest({ boundary, payload })
    const res = createMockResponse()
    const next = createMockNext()

    const handler = fileUpload.array('photos', 5)
    await handler(req as any, res, next)

    expect(next).toHaveBeenCalled()
    expect(Array.isArray(req.files)).toBe(true)
    expect(req.files.length).toBe(2)
    expect(req.files[0].filename).toBe('pic1.jpg')
    expect(req.files[1].filename).toBe('pic2.jpg')
  })

  it('enforces allowed MIME types', async () => {
    const payload =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="doc"; filename="script.exe"\r\n` +
      `Content-Type: application/x-msdownload\r\n\r\n` +
      `malicious\r\n` +
      `--${boundary}--\r\n`

    const req = createMultipartRequest({ boundary, payload })
    const res = createMockResponse()
    let caughtErr: any = null
    const next = (err?: any) => {
      caughtErr = err
    }

    const handler = fileUpload.single('doc', {
      allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    })
    await handler(req as any, res, next)

    expect(caughtErr).toBeDefined()
    expect(caughtErr.statusCode).toBe(400)
    expect(caughtErr.message).toContain('invalid MIME type')
  })

  it('enforces file size limits and returns 413 Payload Too Large', async () => {
    const payload =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="avatar"; filename="large.png"\r\n` +
      `Content-Type: image/png\r\n\r\n` +
      `toolargecontent\r\n` +
      `--${boundary}--\r\n`

    const req = createMultipartRequest({ boundary, payload })
    const res = createMockResponse()
    let caughtErr: any = null
    const next = (err?: any) => {
      caughtErr = err
    }

    const handler = fileUpload.single('avatar', {
      limits: { fileSize: 5 }, // 5 bytes max
    })
    await handler(req as any, res, next)

    expect(caughtErr).toBeDefined()
    expect(caughtErr.statusCode).toBe(413)
    expect(caughtErr.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('fromExpress bridges Express/Connect Multer middleware seamlessly', async () => {
    // Simulated Multer middleware
    const mockMulter = (req: any, res: any, next: (err?: any) => void) => {
      req.file = {
        fieldname: 'avatar',
        originalname: 'multer-test.jpg',
        filename: 'multer-test.jpg',
        mimetype: 'image/jpeg',
        size: 1024,
        buffer: Buffer.from('multer-data'),
      }
      req.body = { title: 'Upload from Multer' }
      next()
    }

    const req = createMockRequest()
    const res = createMockResponse()
    const next = createMockNext()

    const handler = fromExpress(mockMulter)
    handler(req as any, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.file).toBeDefined()
    expect(req.file?.filename).toBe('multer-test.jpg')
    expect((req.body as any)?.title).toBe('Upload from Multer')
  })
})

describe('@Upload() Controller Decorator', () => {
  it('registers file upload middleware when used on a method', () => {
    class TestController {
      @Upload('photo')
      uploadPhoto() {
        return { success: true }
      }
    }

    const instance = new TestController()
    const middlewares =
      MetadataEngine.get(instance.uploadPhoto, METHOD_MIDDLEWARES) ||
      MetadataEngine.get(
        TestController.prototype.uploadPhoto,
        METHOD_MIDDLEWARES
      )

    expect(middlewares).toBeDefined()
    expect(Array.isArray(middlewares)).toBe(true)
    expect(middlewares.length).toBeGreaterThan(0)
  })

  it('can be used with @UseUpload as explicit method decorator', () => {
    class TestController2 {
      @UseUpload({ field: 'avatar', limits: { fileSize: 1024 * 1024 } })
      uploadAvatar() {
        return { ok: true }
      }
    }

    const instance = new TestController2()
    const middlewares =
      MetadataEngine.get(instance.uploadAvatar, METHOD_MIDDLEWARES) ||
      MetadataEngine.get(
        TestController2.prototype.uploadAvatar,
        METHOD_MIDDLEWARES
      )
    expect(middlewares).toBeDefined()
    expect(middlewares.length).toBe(1)
  })
})

describe('Declarative Route-Level Upload (maxSize, destination, allowedMimeTypes)', () => {
  const boundary = '---------------------------974767299852498929531610575'

  it('supports declarative upload with maxSize string, destination, and file/fields ready', async () => {
    const router = new Router()
    let resultFile: any
    let resultFields: any

    await new Promise<void>((resolve) => {
      router.post(
        '/photo',
        {
          upload: {
            field: 'file',
            maxSize: '10MB',
            allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
            destination: 'memory',
          },
        },
        (req, res) => {
          resultFile = (req as any).file
          resultFields = req.body
          res.status(200).json({ ok: true })
          resolve()
        }
      )

      const payload =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="tag"\r\n\r\n` +
        `vacation\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="beach.png"\r\n` +
        `Content-Type: image/png\r\n\r\n` +
        `image-bytes-here\r\n` +
        `--${boundary}--\r\n`

      const req = createMultipartRequest({ boundary, payload, url: '/photo' })
      const res = createMockResponse()

      router.handle(req as any, res as any)
    })

    expect(resultFile).toBeDefined()
    expect(resultFile.filename).toBe('beach.png')
    expect(resultFile.mimetype).toBe('image/png')
    expect(resultFile.buffer).toBeDefined()
    expect(resultFile.buffer.toString()).toBe('image-bytes-here')
    expect(resultFields).toEqual({ tag: 'vacation' })
  })
})
