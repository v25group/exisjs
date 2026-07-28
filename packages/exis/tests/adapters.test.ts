import { App } from '../src/server/app'
import { aws, APIGatewayEvent } from '../src/adapters/aws-lambda'
import { vercel } from '../src/adapters/vercel'
import { describe, expect, it, ex } from '../src/testing'

describe('Serverless Adapters', () => {
  describe('AWS Lambda Adapter', () => {
    it('translates APIGatewayEvent to Exis request and back', async () => {
      const app = new App()
      app.post('/test', async (req, res) => {
        const body = await req.json()
        res.status(201).json({
          echo: body,
          path: req.path,
          query: req.query,
        })
      })

      const handler = aws(app)

      const event: APIGatewayEvent = {
        httpMethod: 'POST',
        path: '/test',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
        isBase64Encoded: false,
        queryStringParameters: { page: '2' },
      }

      const result = await handler(event)

      expect(result.statusCode).toBe(201)
      expect(result.headers['content-type']).toBe(
        'application/json; charset=utf-8'
      )
      expect(result.isBase64Encoded).toBe(true)

      const bodyBuffer = Buffer.from(result.body, 'base64')
      const bodyJson = JSON.parse(bodyBuffer.toString('utf8'))

      expect(bodyJson).toEqual({
        echo: { hello: 'world' },
        path: '/test',
        query: { page: '2' },
      })
    })

    it('handles base64 encoded request bodies', async () => {
      const app = new App()
      app.post('/upload', async (req, res) => {
        const text = await req.text()
        res.send(text) // Echo back the exact buffer string
      })

      const handler = aws(app)

      const payload = 'Secret message'
      const event: APIGatewayEvent = {
        httpMethod: 'POST',
        path: '/upload',
        headers: { 'Content-Type': 'text/plain' },
        body: Buffer.from(payload).toString('base64'),
        isBase64Encoded: true,
      }

      const result = await handler(event)
      const decodedBody = Buffer.from(result.body, 'base64').toString('utf8')

      expect(decodedBody).toBe(payload)
    })
  })

  describe('Vercel Adapter', () => {
    it('returns a handler that invokes app.handle', async () => {
      const app = new App()
      const spy = ex.spyOn(app, 'handle').mockImplementation(async () => {})

      const handler = vercel(app)

      const req = {} as any
      const res = {} as any

      await handler(req, res)

      expect(spy).toHaveBeenCalledWith(req, res)
      spy.mockRestore()
    })
  })
})
