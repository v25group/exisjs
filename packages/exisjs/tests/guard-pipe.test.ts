import { App } from '../src/server/app'
import { guard, pipe } from '../src/middleware/middleware'
import type { Request, Response, NextFunction } from '../src/types'
import { describe, expect, it, ex } from '../src/testing'

describe('Guards and Pipes', () => {
  it('should block request if guard returns false', async () => {
    const app = new App()

    app.get(
      '/admin',
      guard((req: Request) => req.headers['authorization'] === 'secret', {
        message: 'Not allowed',
      }),
      (req: Request, res: Response) => res.send('Admin Data')
    )

    const res1 = await app.inject({ url: '/admin' })
    expect(res1.status).toBe(403)
    expect(res1.body).toEqual({ error: 'Not allowed' })

    const res2 = await app.inject({
      url: '/admin',
      headers: { authorization: 'secret' },
    })
    expect(res2.status).toBe(200)
    expect(res2.body).toBe('Admin Data')
  })

  it('should transform data with pipe', async () => {
    const app = new App()

    app.get(
      '/user/:id',
      pipe('params', 'id', (val: any) => Number(val) * 2),
      (req: Request, res: Response) => res.json({ id: req.params.id })
    )

    const res = await app.inject({ url: '/user/5' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 10 })
  })

  it('should catch errors thrown in pipe and return 400', async () => {
    const app = new App()

    app.get(
      '/bad-pipe',
      // We mock that req.query.age exists to trigger the pipe
      (req: Request, res: Response, next: NextFunction) => {
        req.query.age = 'abc'
        next()
      },
      pipe('query', 'age', (val: any) => {
        if (isNaN(Number(val))) throw new Error('Not a number')
        return Number(val)
      }),
      (req: Request, res: Response) => res.json({ ok: true })
    )

    const res = await app.inject({ url: '/bad-pipe' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Not a number' })
  })
})
