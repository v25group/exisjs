import { controller, route } from 'exisjs/router'
import { cache, guard, pipe } from 'exisjs/middleware'
import { UserParamsSchema } from './schema'
import { getUsers, getUserById } from './controller'
import { tex } from 'exisjs/validator'

class MyService {
  get [Symbol.for('exisjs:scope')]() {
    return 'request'
  }
  sayHello() {
    return 'hello from DI test!'
  }
}

export default controller({
  cors: true,
  middleware: [
    (req: any, res: any, next: any) => {
      console.log('Users file-based route hit via config!')
      next()
    },
  ],
  onError: (err, req, res) => {
    console.log('Users Local Error Handler Caught:', err.message)
    res.status(400).json({ success: false, localError: err.message })
  },
  onResponse: (req, res) => {
    console.log('Users Route sent response with status:', res.statusCode)
  },

  list: route.get('/', {
    middleware: [
      cache({ tags: ['users'], ttlMs: 60000, keyGenerator: (req) => req.path }),
    ],
    async handle({ req, res, resolve }) {
      // Test Dependency Injection
      const myService = resolve(MyService)
      console.log('DI Test:', myService.sayHello())

      // Re-use the existing controller
      return getUsers(req, res)
    },
  }),

  getById: route.get('/:id', {
    params: UserParamsSchema,
    middleware: [
      guard((req) => req.params.id !== '999', {
        message: 'You do not have access to this user',
      }),
      pipe('params', 'id', (val) => Number(val)),
    ],
    async handle(ctx) {
      // Cast ctx.req as any because the type inference from Zod schema to route config generics is currently loose
      return getUserById(ctx.req as any, ctx.res)
    },
  }),

  implicit: route.get('/:id/implicit', {
    params: UserParamsSchema,
    body: tex.object({ role: tex.string() }),
    async handle({ params, body }) {
      return {
        success: true,
        data: {
          id: params.id,
          role: body.role,
          hiddenField: 'THIS SHOULD BE STRIPPED OUT!',
        },
      }
    },
  }),

  fail: route.get('/fail', {
    async handle() {
      throw new Error(
        "This error should be caught by the module's local onError hook!"
      )
    },
  }),
})
