import { describe, it, expect, createTestApp } from '../src/testing'
import { App } from '../src/server/app'
import {
  Controller,
  Post,
  All,
  Head,
  Options,
  RawBody,
  Headers,
  HttpCode,
} from '../src/decorators'
import { route, controller } from '../src/router'
import * as crypto from 'crypto'

describe('RawBody Parameter Decorator & Complete HTTP Decorators Suite', () => {
  describe('@RawBody() in OOP Controller', () => {
    const WEBHOOK_SECRET = 'whsec_test_secret_key_12345'

    @Controller('/webhook')
    class WebhookController {
      @Post('/stripe')
      @HttpCode(200)
      async handleStripe(
        @RawBody() rawBuffer: Buffer,
        @Headers('x-stripe-signature') signature: string
      ) {
        // HMAC verification on raw Buffer
        const expectedSig = crypto
          .createHmac('sha256', WEBHOOK_SECRET)
          .update(rawBuffer)
          .digest('hex')

        const isValid = signature === expectedSig
        return {
          verified: isValid,
          isBuffer: Buffer.isBuffer(rawBuffer),
          byteLength: rawBuffer.length,
          bodyString: rawBuffer.toString('utf8'),
        }
      }

      @Post('/github')
      async handleGitHub(@RawBody('string') rawString: string) {
        return {
          isString: typeof rawString === 'string',
          receivedLength: rawString.length,
          content: rawString,
        }
      }
    }

    it('injects raw unparsed Buffer into controller method for HMAC verification', async () => {
      const app = new App()
      app.registerControllers([WebhookController])
      const client = createTestApp(app)

      const payload = JSON.stringify({
        event: 'payment_intent.succeeded',
        amount: 4900,
      })
      const signature = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(Buffer.from(payload, 'utf8'))
        .digest('hex')

      const res = await client.post('/webhook/stripe', {
        headers: {
          'content-type': 'application/json',
          'x-stripe-signature': signature,
        },
        payload,
      })

      expect(res.status).toBe(200)
      expect(res.body.verified).toBe(true)
      expect(res.body.isBuffer).toBe(true)
      expect(res.body.byteLength).toBe(Buffer.byteLength(payload))
      expect(res.body.bodyString).toBe(payload)
    })

    it('injects rawBody as string when @RawBody("string") is requested', async () => {
      const app = new App()
      app.registerControllers([WebhookController])
      const client = createTestApp(app)

      const payload = 'raw_unformatted_webhook_data_string'
      const res = await client.post('/webhook/github', {
        headers: { 'content-type': 'text/plain' },
        payload,
      })

      expect(res.status).toBe(200)
      expect(res.body.isString).toBe(true)
      expect(res.body.receivedLength).toBe(payload.length)
      expect(res.body.content).toBe(payload)
    })
  })

  describe('req.buffer() & rawBody in Functional Routes', () => {
    it('supports req.buffer() for Buffer retrieval in functional handlers', async () => {
      const app = new App()

      const webhookHandler = route.post('/hook', {
        async handle({ req }) {
          const buf = await req.buffer()
          return {
            isBuffer: Buffer.isBuffer(buf),
            size: buf.length,
            text: buf.toString('utf8'),
          }
        },
      })

      app.post('/hook', webhookHandler as any)
      const client = createTestApp(app)

      const testData = JSON.stringify({ action: 'sync', count: 10 })
      const res = await client.post('/hook', {
        headers: { 'content-type': 'application/json' },
        payload: testData,
      })

      expect(res.status).toBe(200)
      expect(res.body.isBuffer).toBe(true)
      expect(res.body.size).toBe(Buffer.byteLength(testData))
      expect(res.body.text).toBe(testData)
    })
  })

  describe('Complete HTTP Method Decorators (@All, @Head, @Options)', () => {
    @Controller('/gateway')
    class GatewayController {
      @All('/proxy')
      async proxyAll(@Headers('x-custom-action') action: string) {
        return { handled: true, action: action || 'default' }
      }

      @Head('/status')
      async checkStatus() {
        return { ok: true }
      }

      @Options('/resource')
      async resourceOptions() {
        return { allow: 'GET, POST, OPTIONS' }
      }
    }

    it('@All() catches requests from any HTTP method', async () => {
      const app = new App()
      app.registerControllers([GatewayController])
      const client = createTestApp(app)

      const getRes = await client.get('/gateway/proxy', {
        headers: { 'x-custom-action': 'read' },
      })
      expect(getRes.status).toBe(200)
      expect(getRes.body.handled).toBe(true)
      expect(getRes.body.action).toBe('read')

      const postRes = await client.post('/gateway/proxy', {
        headers: { 'x-custom-action': 'write' },
        payload: { data: 1 },
      })
      expect(postRes.status).toBe(200)
      expect(postRes.body.handled).toBe(true)
      expect(postRes.body.action).toBe('write')

      const deleteRes = await client.delete('/gateway/proxy', {
        headers: { 'x-custom-action': 'remove' },
      })
      expect(deleteRes.status).toBe(200)
      expect(deleteRes.body.handled).toBe(true)
      expect(deleteRes.body.action).toBe('remove')
    })

    it('@Options() handles HTTP OPTIONS queries', async () => {
      const app = new App({ cors: false })
      app.registerControllers([GatewayController])
      const client = createTestApp(app)

      const res = await client.options('/gateway/resource')
      expect(res.status).toBe(200)
      expect(res.body.allow).toBe('GET, POST, OPTIONS')
    })
  })
})
