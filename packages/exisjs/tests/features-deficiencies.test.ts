import { describe, it, expect, ex } from '../src/testing'
import { Router, runHandlers } from '../src/router/router'
import { tex, paginate, getPaginationSkip } from '../src/validator/tex'
import { generateCrud, generateModel } from '../src/cli/commands/generate'
import { createMockResponse, createMockNext, getResponseBody } from './helpers'
import { ExisRequest } from '../src/server/request'
import { Readable } from 'node:stream'
import { Socket } from 'node:net'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

function createMultipartRequest(options: {
  boundary: string
  payload: string
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
    url: '/upload',
    headers: {
      'content-type': `multipart/form-data; boundary=${options.boundary}`,
    },
    socket,
  })
  return new ExisRequest(readable as any, createMockResponse() as any)
}

describe('Core Deficiencies Enhancements', () => {
  describe('1. Declarative Route-Level Upload', () => {
    const boundary = '---------------------------974767299852498929531610575'

    it('attaches upload middleware declaratively via route schema', async () => {
      const router = new Router()
      let handledBody: any
      let handledFile: any

      await new Promise<void>((resolve) => {
        router.post(
          '/upload',
          {
            upload: { field: 'avatar', maxBytes: 1024 * 1024 },
          },
          (req, res) => {
            handledBody = req.body
            handledFile = (req as any).file
            res.status(200).json({ success: true })
            resolve()
          }
        )

        const payload =
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="username"\r\n\r\n` +
          `alice\r\n` +
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="avatar"; filename="alice.png"\r\n` +
          `Content-Type: image/png\r\n\r\n` +
          `fake-avatar-data\r\n` +
          `--${boundary}--\r\n`

        const req = createMultipartRequest({ boundary, payload })
        const res = createMockResponse()

        router.handle(req as any, res as any)
      })

      expect(handledBody).toEqual({ username: 'alice' })
      expect(handledFile).toBeDefined()
      expect(handledFile.filename).toBe('alice.png')
      expect(handledFile.buffer.toString()).toBe('fake-avatar-data')
    })

    it('rejects uploads exceeding route-level maxBytes with 413 PayloadTooLargeError', async () => {
      const router = new Router()

      router.post(
        '/upload',
        {
          upload: { field: 'avatar', maxBytes: 10 },
        },
        (_req, res) => {
          res.status(200).json({ success: true })
        }
      )

      const payload =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="avatar"; filename="large.png"\r\n` +
        `Content-Type: image/png\r\n\r\n` +
        `this-is-longer-than-ten-bytes\r\n` +
        `--${boundary}--\r\n`

      const req = createMultipartRequest({ boundary, payload })
      const res = createMockResponse()

      let errorThrown: any = null
      await new Promise<void>((resolve) => {
        router.handle(req as any, res as any, (err) => {
          errorThrown = err
          resolve()
        })
      })

      expect(errorThrown).toBeDefined()
      expect(errorThrown.statusCode).toBe(413)
    })
  })

  describe('2. Declarative Route-Level Timeout', () => {
    it('enforces route-level timeout override', async () => {
      const router = new Router()

      router.get(
        '/slow',
        {
          timeout: 40,
        },
        async (_req, res) => {
          // Keep active longer than timeout
          await new Promise((r) => setTimeout(r, 100))
          if (!res.headersSent) {
            res.status(200).json({ ok: true })
          }
        }
      )

      const rawReq = new Readable({
        read() {
          this.push(null)
        },
      })
      Object.assign(rawReq, { method: 'GET', url: '/slow', headers: {} })
      const res = createMockResponse()
      const req = new ExisRequest(rawReq as any, res as any)

      router.handle(req as any, res as any)

      // Wait 60ms for timeout to trigger
      await new Promise((r) => setTimeout(r, 60))

      expect(res.statusCode).toBe(503)
      const body = getResponseBody<any>(res)
      expect(body.error?.code).toBe('TIMEOUT')
      expect(body.error?.message).toContain('timeout')
    })
  })

  describe('3. Pagination Standardization & Helpers', () => {
    it('validates and coerces pagination query with tex.pagination()', () => {
      const schema = tex.pagination({ defaultLimit: 20, maxLimit: 50 })

      // Defaults
      const parsedDefault = schema.parse({})
      expect(parsedDefault.page).toBe(1)
      expect(parsedDefault.limit).toBe(20)

      // String coercion
      const parsedCoerced = schema.parse({ page: '3', limit: '30' })
      expect(parsedCoerced.page).toBe(3)
      expect(parsedCoerced.limit).toBe(30)

      // Rejects when exceeding max limit
      expect(() => schema.parse({ page: '1', limit: '100' })).toThrow()
    })

    it('calculates getPaginationSkip correctly', () => {
      expect(getPaginationSkip({ page: 1, limit: 10 }).skip).toBe(0)
      expect(getPaginationSkip({ page: 2, limit: 10 }).skip).toBe(10)
      expect(getPaginationSkip({ page: 5, limit: 25 }).skip).toBe(100)
    })

    it('wraps items in a standardized PaginatedResult envelope', () => {
      const items = [{ id: 1 }, { id: 2 }]
      const result = paginate(items, 45, { page: 2, limit: 10 })

      expect(result).toEqual({
        data: items,
        pagination: {
          total: 45,
          page: 2,
          limit: 10,
          totalPages: 5,
          hasNextPage: true,
          hasPrevPage: true,
          hasNext: true,
          hasPrev: true,
        },
      })

      // Last page
      const lastPageResult = paginate(items, 45, { page: 5, limit: 10 })
      expect(lastPageResult.pagination.hasNext).toBe(false)
      expect(lastPageResult.pagination.hasPrev).toBe(true)

      // First page
      const firstPageResult = paginate(items, 45, { page: 1, limit: 10 })
      expect(firstPageResult.pagination.hasNext).toBe(true)
      expect(firstPageResult.pagination.hasPrev).toBe(false)
    })
  })

  describe('4. Deeply Nested Validation with tex', () => {
    it('validates arbitrary nested sub-documents and nested arrays', () => {
      const schema = tex.object({
        user: tex.object({
          name: tex.string({ min: 2 }),
          profile: tex.object({
            bio: tex.string({ optional: true }),
            skills: tex.array(tex.string()),
          }),
        }),
      })

      const valid = {
        user: {
          name: 'Jane',
          profile: {
            bio: 'Software Engineer',
            skills: ['TypeScript', 'Rust'],
          },
        },
      }

      const parsed = schema.parse(valid)
      expect(parsed).toEqual(valid)
    })

    it('rejects invalid nested fields with clear errors', () => {
      const schema = tex.object({
        user: tex.object({
          name: tex.string({ min: 2 }),
          profile: tex.object({
            skills: tex.array(tex.string()),
          }),
        }),
      })

      const invalid = {
        user: {
          name: 'A', // too short
          profile: {
            skills: ['Valid', 123], // 123 is not a string
          },
        },
      }

      expect(() => schema.parse(invalid)).toThrow()
    })
  })

  describe('5. CLI 4-File CRUD Generator', () => {
    it('generates route, schema, service, and model files via generateCrud', async () => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'exis-crud-test-')
      )

      try {
        await generateCrud('product', tempDir)

        const routePath = path.join(
          tempDir,
          'src',
          'http',
          'product',
          'route.ts'
        )
        const schemaPath = path.join(
          tempDir,
          'src',
          'http',
          'product',
          'schema.ts'
        )
        const servicePath = path.join(
          tempDir,
          'src',
          'http',
          'product',
          'service.ts'
        )
        const modelPath = path.join(tempDir, 'src', 'models', 'Product.ts')

        const [routeContent, schemaContent, serviceContent, modelContent] =
          await Promise.all([
            fs.readFile(routePath, 'utf8'),
            fs.readFile(schemaPath, 'utf8'),
            fs.readFile(servicePath, 'utf8'),
            fs.readFile(modelPath, 'utf8'),
          ])

        // Verify route
        expect(routeContent).toContain('controller({')
        expect(routeContent).toContain('ProductPaginationSchema')
        expect(routeContent).toContain('createProduct')

        // Verify schema
        expect(routeContent).toContain('CreateProductSchema')
        expect(schemaContent).toContain(
          'ProductPaginationSchema = tex.pagination('
        )
        expect(schemaContent).toContain('CreateProductSchema = tex.object({')

        // Verify service
        expect(serviceContent).toContain('export async function getProducts')
        expect(serviceContent).toContain('export async function createProduct')
        expect(serviceContent).toContain('paginate(')

        // Verify model
        expect(modelContent).toContain('export interface Product')
        expect(modelContent).toContain('export type CreateProductInput')
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true })
      }
    })

    it('generates standalone model via generateModel', async () => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'exis-model-test-')
      )

      try {
        await generateModel('customer', tempDir, { named: true })
        const modelPath = path.join(
          tempDir,
          'src',
          'models',
          'customer.model.ts'
        )
        const modelContent = await fs.readFile(modelPath, 'utf8')

        expect(modelContent).toContain('export interface Customer')
        expect(modelContent).toContain('export type CreateCustomerInput')
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true })
      }
    })
  })
})
