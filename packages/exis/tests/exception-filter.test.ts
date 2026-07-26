import { App } from '../src/server/app'
import { catchError } from '../src/middleware/exception-filter'
import { describe, it, expect } from '../src/testing'

class CustomDatabaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomDatabaseError'
  }
}

class AnotherError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnotherError'
  }
}

describe('Exception Filter (catchError)', () => {
  it('should catch the specific error class and format the response', async () => {
    const app = new App()

    app.use(
      catchError(CustomDatabaseError, (err, req, res) => {
        res.status(400).json({ customCode: 'DB_ERR', msg: err.message })
      })
    )

    app.get('/', () => {
      throw new CustomDatabaseError('Connection failed')
    })

    const res = await app.inject({ url: '/' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ customCode: 'DB_ERR', msg: 'Connection failed' })
  })

  it('should fall through to the default handler if the error is not an instance of the class', async () => {
    const app = new App({ env: 'production' })

    app.use(
      catchError(CustomDatabaseError, (err, req, res) => {
        res.status(400).json({ customCode: 'DB_ERR' })
      })
    )

    app.get('/', () => {
      throw new AnotherError('Something else broke')
    })

    const res = await app.inject({ url: '/' })
    expect(res.status).toBe(500)
    // Default global handler responds with INTERNAL_ERROR
    expect(res.body.error.code).toBe('INTERNAL_ERROR')
  })

  it('should catch errors asynchronously', async () => {
    const app = new App()

    app.use(
      catchError(CustomDatabaseError, async (err, req, res) => {
        await new Promise((r) => setTimeout(r, 10))
        res.status(418).json({ teapot: true })
      })
    )

    app.get('/', () => {
      throw new CustomDatabaseError('DB')
    })

    const res = await app.inject({ url: '/' })
    expect(res.status).toBe(418)
    expect(res.body).toEqual({ teapot: true })
  })
})
