import { test, describe, expect } from 'exisjs/testing'
import { exis } from 'exisjs'
import { serverlessAws } from 'exisjs/adapters'

describe('AWS Lambda Adapter', () => {
  test('should correctly process an API Gateway event', async () => {
    // 1. Create a simple Exis app
    const app = exis()
    
    app.get('/hello', (req, res) => {
      res.json({ message: 'Hello from AWS Lambda!' })
    })

    // 2. Wrap it with the AWS adapter
    const handler = serverlessAws(app)

    // 3. Mock an API Gateway Event
    const mockEvent = {
      httpMethod: 'GET',
      path: '/hello',
      headers: {
        'x-my-header': 'test'
      },
      body: null,
      isBase64Encoded: false,
    }

    // 4. Execute the handler
    const result = await handler(mockEvent as any)

    // 5. Assert the API Gateway Result
    expect(result.statusCode).toBe(200)
    
    // The AWS adapter encodes the body as base64 for API Gateway
    const decodedBody = Buffer.from(result.body, 'base64').toString('utf8')
    expect(decodedBody).toBe('{"message":"Hello from AWS Lambda!"}')
  })
})
